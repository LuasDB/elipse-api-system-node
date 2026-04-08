import { ObjectId } from 'mongodb'
import { db } from './../db/mongoClient.js'
import Boom from '@hapi/boom'

class Contracts {
  constructor() {
    this.collection = 'contracts'
  }

  async create(data) {
    try {
      const { projectId, unitId, buyerId } = data
      if (!projectId) throw Boom.badData('El proyecto es requerido')
      if (!unitId) throw Boom.badData('La unidad es requerida')
      if (!buyerId) throw Boom.badData('El comprador es requerido')

      // Verificar que la unidad exista y esté disponible
      if (!ObjectId.isValid(unitId)) throw Boom.badRequest('El ID de la unidad no es válido')
      const unit = await db.collection('units').findOne({ _id: new ObjectId(unitId) })
      if (!unit) throw Boom.notFound('La unidad no existe')
      if (unit.status !== 'disponible' && unit.status !== 'apartada') {
        throw Boom.conflict(`La unidad "${unit.identifier}" no está disponible (estado actual: ${unit.status})`)
      }

      // Verificar que no tenga ya un contrato activo
      const existingContract = await db.collection(this.collection).findOne({
        unitId,
        status: { $nin: ['cancelado'] }
      })
      if (existingContract) {
        throw Boom.conflict(`La unidad "${unit.identifier}" ya tiene un contrato activo`)
      }

      // Verificar comprador
      if (!ObjectId.isValid(buyerId)) throw Boom.badRequest('El ID del comprador no es válido')
      const buyer = await db.collection('buyers').findOne({ _id: new ObjectId(buyerId) })
      if (!buyer) throw Boom.notFound('El comprador no existe')

      const contract = {
        ...data,
        contractNumber: data.contractNumber || await this.generateContractNumber(projectId),
        salePrice: Number(data.salePrice) || 0,
        downPayment: Number(data.downPayment) || 0,
        monthlyPayment: Number(data.monthlyPayment) || 0,
        totalPayments: Number(data.totalPayments) || 0,
        status: data.status || 'promesa',
        // Snapshots para referencia rápida
        buyerName: buyer.name,
        unitIdentifier: unit.identifier,
        signatures: data.signatures || [],
        createdAt: new Date(),
        updatedAt: new Date()
      }

      const result = await db.collection(this.collection).insertOne(contract)

      // Actualizar estado de la unidad a "apartada" o "en_escrituracion"
      const newUnitStatus = data.status === 'definitivo' ? 'en_escrituracion' : 'apartada'
      await db.collection('units').updateOne(
        { _id: new ObjectId(unitId) },
        { $set: { status: newUnitStatus, buyerId, updatedAt: new Date() } }
      )

      return { _id: result.insertedId, ...contract }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al crear el contrato', error)
    }
  }

  async generateContractNumber(projectId) {
    const count = await db.collection(this.collection).countDocuments({ projectId })
    const year = new Date().getFullYear()
    return `CONT-${year}-${String(count + 1).padStart(4, '0')}`
  }

  async getAll(filters = {}) {
    try {
      const query = {}
      if (filters.projectId) query.projectId = filters.projectId
      if (filters.status) query.status = filters.status
      if (filters.buyerId) query.buyerId = filters.buyerId
      if (filters.sellerId) query.sellerId = filters.sellerId
      if (filters.search) {
        query.$or = [
          { contractNumber: { $regex: filters.search, $options: 'i' } },
          { buyerName: { $regex: filters.search, $options: 'i' } },
          { unitIdentifier: { $regex: filters.search, $options: 'i' } }
        ]
      }

      const contracts = await db.collection(this.collection)
        .find(query)
        .sort({ createdAt: -1 })
        .toArray()

      // Enriquecer con datos del proyecto
      const enriched = await Promise.all(
        contracts.map(async (contract) => {
          let projectName = ''
          if (contract.projectId && ObjectId.isValid(contract.projectId)) {
            const project = await db.collection('projects').findOne(
              { _id: new ObjectId(contract.projectId) },
              { projection: { name: 1 } }
            )
            projectName = project?.name || ''
          }
          return { ...contract, projectName }
        })
      )

      return enriched
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener contratos', error)
    }
  }

  async getOneById(id) {
    try {
      if (!ObjectId.isValid(id)) throw Boom.badRequest('El ID del contrato no es válido')
      const contract = await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
      if (!contract) throw Boom.notFound(`No se encontró el contrato con ID ${id}`)

      // Enriquecer con datos completos
      let buyer = null, unit = null, project = null, seller = null

      if (contract.buyerId && ObjectId.isValid(contract.buyerId)) {
        buyer = await db.collection('buyers').findOne({ _id: new ObjectId(contract.buyerId) })
      }
      if (contract.unitId && ObjectId.isValid(contract.unitId)) {
        unit = await db.collection('units').findOne({ _id: new ObjectId(contract.unitId) })
      }
      if (contract.projectId && ObjectId.isValid(contract.projectId)) {
        project = await db.collection('projects').findOne({ _id: new ObjectId(contract.projectId) })
      }
      if (contract.sellerId && ObjectId.isValid(contract.sellerId)) {
        seller = await db.collection('users').findOne(
          { _id: new ObjectId(contract.sellerId) },
          { projection: { password: 0 } }
        )
      }

      return { ...contract, buyer, unit, project, seller }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener el contrato', error)
    }
  }

  async updateOneById(id, newData) {
    try {
      if (!ObjectId.isValid(id)) throw Boom.badRequest('El ID del contrato no es válido')

      const existing = await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
      if (!existing) throw Boom.notFound(`No se encontró el contrato con ID ${id}`)

      const { _id, buyer, unit, project, seller, projectName, ...dataToUpdate } = newData
      dataToUpdate.updatedAt = new Date()

      // Convertir numéricos
      const numericFields = ['salePrice', 'downPayment', 'monthlyPayment', 'totalPayments']
      numericFields.forEach(field => {
        if (dataToUpdate[field] !== undefined) dataToUpdate[field] = Number(dataToUpdate[field]) || 0
      })

      const result = await db.collection(this.collection).updateOne(
        { _id: new ObjectId(id) },
        { $set: dataToUpdate }
      )

      // Si cambió el estado del contrato, actualizar la unidad
      if (dataToUpdate.status && dataToUpdate.status !== existing.status) {
        const unitStatusMap = {
          'promesa': 'apartada',
          'definitivo': 'en_escrituracion',
          'escriturado': 'vendida',
          'entregado': 'entregada',
          'cancelado': 'disponible'
        }
        const newUnitStatus = unitStatusMap[dataToUpdate.status]
        if (newUnitStatus && existing.unitId) {
          const unitUpdate = { status: newUnitStatus, updatedAt: new Date() }
          if (dataToUpdate.status === 'cancelado') {
            unitUpdate.buyerId = null
          }
          await db.collection('units').updateOne(
            { _id: new ObjectId(existing.unitId) },
            { $set: unitUpdate }
          )
        }
      }

      return result
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al actualizar el contrato', error)
    }
  }

  async deleteOneById(id) {
    try {
      if (!ObjectId.isValid(id)) throw Boom.badRequest('El ID del contrato no es válido')

      const contract = await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
      if (!contract) throw Boom.notFound(`No se encontró el contrato con ID ${id}`)

      // Liberar la unidad
      if (contract.unitId && ObjectId.isValid(contract.unitId)) {
        await db.collection('units').updateOne(
          { _id: new ObjectId(contract.unitId) },
          { $set: { status: 'disponible', buyerId: null, updatedAt: new Date() } }
        )
      }

      const result = await db.collection(this.collection).deleteOne({ _id: new ObjectId(id) })
      return result
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al eliminar el contrato', error)
    }
  }

  async addFiles(id, files) {
  try {
    if (!ObjectId.isValid(id)) throw Boom.badRequest('El ID del contrato no es válido')

    const contract = await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
    if (!contract) throw Boom.notFound(`No se encontró el contrato con ID ${id}`)

    const fileRecords = files.map(file => ({
      originalName: file.originalname,
      fileName: file.filename,
      path: file.path,
      size: file.size,
      mimetype: file.mimetype,
      uploadedAt: new Date()
    }))

    const result = await db.collection(this.collection).updateOne(
      { _id: new ObjectId(id) },
      {
        $push: { files: { $each: fileRecords } },
        $set: { updatedAt: new Date() }
      }
    )

    return { filesAdded: fileRecords.length, files: fileRecords }
  } catch (error) {
    if (Boom.isBoom(error)) throw error
    throw Boom.badImplementation('Error al agregar archivos', error)
  }
}

async removeFile(id, fileName) {
  try {
    if (!ObjectId.isValid(id)) throw Boom.badRequest('El ID del contrato no es válido')

    const result = await db.collection(this.collection).updateOne(
      { _id: new ObjectId(id) },
      {
        $pull: { files: { fileName } },
        $set: { updatedAt: new Date() }
      }
    )

    // Eliminar archivo físico
    const filePath = `uploads/contracts/${id}/${fileName}`
    const fs = await import('fs')
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    } 

    return result
  } catch (error) {
    if (Boom.isBoom(error)) throw error
    throw Boom.badImplementation('Error al eliminar archivo', error)
  }
}
}

export default Contracts
