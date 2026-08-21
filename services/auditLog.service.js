import { db } from '../db/mongoClient.js'
import Boom from '@hapi/boom'

class AuditLog {
  constructor() {
    this.collection = 'auditLogs'
  }

  async record({ entity, entityId, action, userId, userName, changes, meta }) {
    try {
      await db.collection(this.collection).insertOne({
        entity,
        entityId: entityId ? String(entityId) : null,
        action,
        userId: userId ? String(userId) : null,
        userName: userName || null,
        changes: changes || null,
        meta: meta || null,
        createdAt: new Date()
      })
    } catch (error) {
      // El historial no debe tumbar la operación principal si falla el registro
      console.error('Error al registrar auditLog:', error)
    }
  }

  async getByEntity(entity, entityId) {
    try {
      return await db.collection(this.collection)
        .find({ entity, entityId: String(entityId) })
        .sort({ createdAt: -1 })
        .toArray()
    } catch (error) {
      throw Boom.badImplementation('Error al obtener el historial', error)
    }
  }
}

export default AuditLog
