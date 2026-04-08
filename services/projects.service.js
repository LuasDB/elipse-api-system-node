import { ObjectId } from 'mongodb'
import { db } from './../db/mongoClient.js'
import Boom from '@hapi/boom'

class Projects {
  constructor() {
    this.collection = 'projects'
  }

  async create(data) {
    try {
      const { name } = data
      if (!name || !name.trim()) {
        throw Boom.badData('El nombre del proyecto es requerido')
      }

      const project = {
        ...data,
        totalUnits: Number(data.totalUnits) || 0,
        status: data.status || 'en_preventa',
        createdAt: new Date(),
        updatedAt: new Date()
      }

      const result = await db.collection(this.collection).insertOne(project)
      return { _id: result.insertedId, ...project }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al crear el proyecto', error)
    }
  }

  async getAll(filters = {}) {
    try {
      const query = {}

      if (filters.status) query.status = filters.status
      if (filters.type) query.type = filters.type
      if (filters.search) {
        query.$or = [
          { name: { $regex: filters.search, $options: 'i' } },
          { address: { $regex: filters.search, $options: 'i' } },
          { colony: { $regex: filters.search, $options: 'i' } },
          { city: { $regex: filters.search, $options: 'i' } }
        ]
      }

      const projects = await db.collection(this.collection)
        .find(query)
        .sort({ createdAt: -1 })
        .toArray()

      // Enriquecer con conteo de unidades por estado
      const enriched = await Promise.all(
        projects.map(async (project) => {
          const unitStats = await db.collection('units').aggregate([
            { $match: { projectId: project._id.toString() } },
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 }
              }
            }
          ]).toArray()

          const stats = {
            total: 0,
            disponible: 0,
            apartada: 0,
            vendida: 0,
            entregada: 0,
            en_escrituracion: 0,
            cancelada: 0
          }

          unitStats.forEach(s => {
            stats[s._id] = s.count
            stats.total += s.count
          })

          return { ...project, unitStats: stats }
        })
      )

      return enriched
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener proyectos', error)
    }
  }

  async getOneById(id) {
    try {
      if (!ObjectId.isValid(id)) {
        throw Boom.badRequest('El ID del proyecto no es válido')
      }

      const project = await db.collection(this.collection).findOne({ _id: new ObjectId(id) })

      if (!project) {
        throw Boom.notFound(`No se encontró el proyecto con ID ${id}`)
      }

      // Obtener estadísticas de unidades
      const unitStats = await db.collection('units').aggregate([
        { $match: { projectId: id } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]).toArray()

      const stats = {
        total: 0, disponible: 0, apartada: 0, vendida: 0,
        entregada: 0, en_escrituracion: 0, cancelada: 0
      }
      unitStats.forEach(s => {
        stats[s._id] = s.count
        stats.total += s.count
      })

      return { ...project, unitStats: stats }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener el proyecto', error)
    }
  }

  async updateOneById(id, newData) {
    try {
      if (!ObjectId.isValid(id)) {
        throw Boom.badRequest('El ID del proyecto no es válido')
      }

      const { _id, unitStats, ...dataToUpdate } = newData
      dataToUpdate.updatedAt = new Date()
      if (dataToUpdate.totalUnits) dataToUpdate.totalUnits = Number(dataToUpdate.totalUnits)

      const result = await db.collection(this.collection).updateOne(
        { _id: new ObjectId(id) },
        { $set: dataToUpdate }
      )

      if (result.matchedCount === 0) {
        throw Boom.notFound(`No se encontró el proyecto con ID ${id}`)
      }

      return result
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al actualizar el proyecto', error)
    }
  }

  async deleteOneById(id) {
    try {
      if (!ObjectId.isValid(id)) {
        throw Boom.badRequest('El ID del proyecto no es válido')
      }

      // Verificar si tiene unidades asociadas
      const unitsCount = await db.collection('units').countDocuments({ projectId: id })
      if (unitsCount > 0) {
        throw Boom.conflict(`No se puede eliminar el proyecto porque tiene ${unitsCount} unidades asociadas. Elimina las unidades primero.`)
      }

      const result = await db.collection(this.collection).deleteOne({ _id: new ObjectId(id) })

      if (result.deletedCount === 0) {
        throw Boom.notFound(`No se encontró el proyecto con ID ${id}`)
      }

      return result
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al eliminar el proyecto', error)
    }
  }
}

export default Projects
