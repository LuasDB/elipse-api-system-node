import { ObjectId } from 'mongodb'
import { db } from '../db/mongoClient.js'
import Boom from '@hapi/boom'
import fs from 'fs/promises'
import path from 'path'

class Attachments {
  constructor() {
    this.collection = 'attachments'
    this.uploadDir = 'uploads'
  }

  // Crear directorios por fecha (mejor organización)
  async createUploadPath(relatedTo) {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')

    const uploadPath = path.join(this.uploadDir, relatedTo, String(year), month)

    try {
      await fs.mkdir(uploadPath, { recursive: true })
      return uploadPath
    } catch (error) {
      throw Boom.badImplementation('No se pudo crear el directorio de uploads', error)
    }
  }

  // Generar nombre único para el archivo
  generateUniqueFilename(originalName) {
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 8)
    const ext = path.extname(originalName)
    const nameWithoutExt = path.basename(originalName, ext)

    return `${nameWithoutExt}_${timestamp}_${random}${ext}`
  }

  async create(fileData) {
    try {
      const {
        file,
        uploadedBy,
        relatedTo,
        relatedId,
        ticketId
      } = fileData

      // Validar tipo de archivo (solo imágenes por ahora, puedes expandir)
      const allowedMimeTypes = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf'
      ]

      if (!allowedMimeTypes.includes(file.mimetype)) {
        throw Boom.badRequest('Tipo de archivo no permitido')
      }

      // Validar tamaño (ej: máximo 5MB)
      const maxSize = 5 * 1024 * 1024 // 5MB
      if (file.size > maxSize) {
        throw Boom.badRequest('El archivo es demasiado grande (máximo 5MB)')
      }

      // Crear ruta de almacenamiento
      const uploadPath = await this.createUploadPath(relatedTo)
      const storedFilename = this.generateUniqueFilename(file.originalname)
      const filepath = path.join(uploadPath, storedFilename)

      // Guardar archivo (esto depende de tu middleware de upload)
      // Asumiendo que usas multer, el archivo ya está en file.buffer o file.path
      if (file.buffer) {
        await fs.writeFile(filepath, file.buffer)
      } else if (file.path) {
        // Si multer ya guardó el archivo temporalmente
        await fs.rename(file.path, filepath)
      }

      // Crear registro en base de datos
      const newAttachment = {
        filename: file.originalname,
        storedFilename,
        filepath: `/${filepath.replace(/\\/g, '/')}`, // Normalizar path para URLs
        mimetype: file.mimetype,
        size: file.size,
        uploadedBy: new ObjectId(uploadedBy),
        relatedTo,
        relatedId: new ObjectId(relatedId),
        ticketId: ticketId ? new ObjectId(ticketId) : null,
        expirationDate: null, // Se establece cuando se cierra el ticket
        isExpired: false,
        createdAt: new Date()
      }

      const result = await db.collection(this.collection).insertOne(newAttachment)

      return {
        _id: result.insertedId,
        ...newAttachment
      }
    } catch (error) {
      if (Boom.isBoom(error)) {
        throw error
      } else {
        throw Boom.badImplementation('No se pudo subir el archivo', error)
      }
    }
  }

  async getById(id) {
    try {
      if (!ObjectId.isValid(id)) {
        throw Boom.badRequest('ID inválido')
      }

      const attachment = await db.collection(this.collection)
        .findOne({ _id: new ObjectId(id) })

      if (!attachment) {
        throw Boom.notFound('Archivo no encontrado')
      }

      // Verificar si el archivo ha expirado
      if (attachment.isExpired) {
        throw Boom.gone('El archivo ha expirado y fue eliminado')
      }

      return attachment
    } catch (error) {
      if (Boom.isBoom(error)) {
        throw error
      } else {
        throw Boom.badImplementation('No se pudo obtener el archivo', error)
      }
    }
  }

  async getByRelatedId(relatedTo, relatedId) {
    try {
      if (!ObjectId.isValid(relatedId)) {
        throw Boom.badRequest('ID inválido')
      }

      const attachments = await db.collection(this.collection)
        .find({
          relatedTo,
          relatedId: new ObjectId(relatedId),
          isExpired: false
        })
        .sort({ createdAt: -1 })
        .toArray()

      return attachments
    } catch (error) {
      throw Boom.badImplementation('No se pudieron obtener los archivos', error)
    }
  }

  async deleteById(id) {
    try {
      if (!ObjectId.isValid(id)) {
        throw Boom.badRequest('ID inválido')
      }

      const attachment = await this.getById(id)

      // Eliminar archivo físico
      try {
        await fs.unlink(attachment.filepath.substring(1)) // Remover el '/' inicial
      } catch (error) {
        console.error('Error al eliminar archivo físico:', error)
        // Continuar aunque falle (el archivo puede no existir)
      }

      // Eliminar registro de base de datos
      const result = await db.collection(this.collection)
        .deleteOne({ _id: new ObjectId(id) })

      return result
    } catch (error) {
      if (Boom.isBoom(error)) {
        throw error
      } else {
        throw Boom.badImplementation('No se pudo eliminar el archivo', error)
      }
    }
  }

  // Marcar archivos como expirados (proceso automático)
  async markExpiredFiles() {
    try {
      const now = new Date()

      // Buscar archivos cuya fecha de expiración ya pasó
      const expiredFiles = await db.collection(this.collection)
        .find({
          expirationDate: { $lte: now },
          isExpired: false
        })
        .toArray()

      // Marcar como expirados y eliminar archivos físicos
      for (const file of expiredFiles) {
        try {
          // Eliminar archivo físico
          await fs.unlink(file.filepath.substring(1))

          // Marcar como expirado en BD
          await db.collection(this.collection).updateOne(
            { _id: file._id },
            { $set: { isExpired: true } }
          )
        } catch (error) {
          console.error(`Error al procesar archivo expirado ${file._id}:`, error)
        }
      }

      return {
        processed: expiredFiles.length,
        files: expiredFiles
      }
    } catch (error) {
      throw Boom.badImplementation('Error al procesar archivos expirados', error)
    }
  }

  // Limpiar archivos expirados permanentemente (eliminar registros BD)
  async cleanExpiredFiles(daysOld = 7) {
    try {
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - daysOld)

      const result = await db.collection(this.collection).deleteMany({
        isExpired: true,
        expirationDate: { $lte: cutoffDate }
      })

      return result
    } catch (error) {
      throw Boom.badImplementation('Error al limpiar archivos expirados', error)
    }
  }

  // Obtener estadísticas de almacenamiento
  async getStorageStats() {
    try {
      const stats = await db.collection(this.collection).aggregate([
        {
          $facet: {
            totalSize: [
              { $match: { isExpired: false } },
              { $group: { _id: null, total: { $sum: '$size' } } }
            ],
            byType: [
              { $match: { isExpired: false } },
              { $group: { _id: '$mimetype', count: { $sum: 1 }, size: { $sum: '$size' } } }
            ],
            byRelatedTo: [
              { $match: { isExpired: false } },
              { $group: { _id: '$relatedTo', count: { $sum: 1 }, size: { $sum: '$size' } } }
            ],
            expiringSoon: [
              {
                $match: {
                  isExpired: false,
                  expirationDate: {
                    $gte: new Date(),
                    $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // Próximos 7 días
                  }
                }
              },
              { $count: 'count' }
            ]
          }
        }
      ]).toArray()

      return stats[0]
    } catch (error) {
      throw Boom.badImplementation('No se pudieron obtener las estadísticas', error)
    }
  }
}

export default Attachments
