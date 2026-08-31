import { ObjectId } from 'mongodb'
import { db } from './../db/mongoClient.js'
import Boom from '@hapi/boom'
import AuditLog from './auditLog.service.js'
import { diff } from '../utils/audit.util.js'

class Units {
  constructor() {
    this.collection = 'units'
    this.auditLog = new AuditLog()
  }

  async create(data, context) {
    try {
      const { projectId, identifier } = data
      if (!projectId) throw Boom.badData('El ID del proyecto es requerido')
      if (!identifier || !identifier.trim()) throw Boom.badData('El identificador de la unidad es requerido')

      // Verificar que el proyecto exista
      if (!ObjectId.isValid(projectId)) throw Boom.badRequest('El ID del proyecto no es válido')
      const project = await db.collection('projects').findOne({ _id: new ObjectId(projectId) })
      if (!project) throw Boom.notFound('El proyecto asociado no existe')

      // Verificar duplicado de identificador en el mismo proyecto
      const existing = await db.collection(this.collection).findOne({ projectId, identifier })
      if (existing) throw Boom.conflict(`Ya existe una unidad con el identificador "${identifier}" en este proyecto`)

      const unit = {
        ...data,
        totalArea: Number(data.totalArea) || 0,
        builtArea: Number(data.builtArea) || 0,
        coveredArea: Number(data.coveredArea) || 0,
        openArea: Number(data.openArea) || 0,
        bedrooms: Number(data.bedrooms) || 0,
        bathrooms: Number(data.bathrooms) || 0,
        halfBathrooms: Number(data.halfBathrooms) || 0,
        parkingSpaces: Number(data.parkingSpaces) || 0,
        listPrice: Number(data.listPrice) || 0,
        finalPrice: Number(data.finalPrice) || 0,
        currency: 'USD',
        floor: Number(data.floor) || 0,
        terraceArea: Number(data.terraceArea) || 0,
        gardenArea: Number(data.gardenArea) || 0,
        storageArea: Number(data.storageArea) || 0,
        hasStorage: data.hasStorage || false,
        hasTerrace: data.hasTerrace || false,
        hasGarden: data.hasGarden || false,
        status: data.status || 'disponible',
        createdAt: new Date(),
        updatedAt: new Date()
      }

      const result = await db.collection(this.collection).insertOne(unit)

      await this.auditLog.record({
        entity: 'unit',
        entityId: result.insertedId,
        entityLabel: unit.identifier,
        action: 'created',
        actor: context?.actor,
        snapshot: { _id: result.insertedId, ...unit },
        meta: context ? { ip: context.ip } : null
      })

      return { _id: result.insertedId, ...unit }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al crear la unidad', error)
    }
  }

  async getByProject(projectId, filters = {}) {
    try {
      const query = { projectId }

      if (filters.status) query.status = filters.status
      if (filters.type) query.unitType = filters.type
      if (filters.search) {
        query.$or = [
          { identifier: { $regex: filters.search, $options: 'i' } },
          { notes: { $regex: filters.search, $options: 'i' } }
        ]
      }

      const units = await db.collection(this.collection)
        .find(query)
        .sort({ identifier: 1 })
        .toArray()

      return units
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener las unidades', error)
    }
  }

  async getOneById(id) {
    try {
      if (!ObjectId.isValid(id)) throw Boom.badRequest('El ID de la unidad no es válido')

      const unit = await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
      if (!unit) throw Boom.notFound(`No se encontró la unidad con ID ${id}`)

      return unit
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener la unidad', error)
    }
  }

  async updateOneById(id, newData, context) {
    try {
      if (!ObjectId.isValid(id)) throw Boom.badRequest('El ID de la unidad no es válido')

      const { _id, ...dataToUpdate } = newData
      dataToUpdate.updatedAt = new Date()

      // Convertir numéricos
      const numericFields = ['totalArea', 'builtArea', 'coveredArea', 'openArea', 'bedrooms', 'bathrooms', 'halfBathrooms', 'parkingSpaces', 'listPrice', 'finalPrice', 'floor', 'terraceArea', 'gardenArea', 'storageArea']

      const existing = await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
      if (!existing) {
        throw Boom.notFound(`No se encontró la unidad con ID ${id}`)
      }

      const result = await db.collection(this.collection).updateOne(
        { _id: new ObjectId(id) },
        { $set: dataToUpdate }
      )

      if (result.matchedCount === 0) {
        throw Boom.notFound(`No se encontró la unidad con ID ${id}`)
      }

      const changes = diff(existing, dataToUpdate)
      if (changes.length) {
        await this.auditLog.record({
          entity: 'unit',
          entityId: id,
          entityLabel: existing.identifier,
          action: 'updated',
          actor: context?.actor,
          changes,
          meta: context ? { ip: context.ip } : null
        })
      }

      return result
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al actualizar la unidad', error)
    }
  }

  async deleteOneById(id, context) {
    try {
      if (!ObjectId.isValid(id)) throw Boom.badRequest('El ID de la unidad no es válido')

      // TODO: Verificar si tiene contrato o pagos asociados antes de eliminar

      const existing = await db.collection(this.collection).findOne({ _id: new ObjectId(id) })

      const result = await db.collection(this.collection).deleteOne({ _id: new ObjectId(id) })
      if (result.deletedCount === 0) throw Boom.notFound(`No se encontró la unidad con ID ${id}`)

      await this.auditLog.record({
        entity: 'unit',
        entityId: id,
        entityLabel: existing?.identifier,
        action: 'deleted',
        actor: context?.actor,
        snapshot: existing,
        meta: context ? { ip: context.ip } : null
      })

      return result
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al eliminar la unidad', error)
    }
  }
}

export default Units
