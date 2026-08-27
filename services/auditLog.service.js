import { db } from '../db/mongoClient.js'
import Boom from '@hapi/boom'
import { actorFrom, sanitize, escapeRegex } from '../utils/audit.util.js'

const COLLECTION = 'auditLogs'

// Acciones consideradas "de baja": el registro guarda un snapshot del documento.
export const AUDIT_ACTIONS = {
  CREATED: 'created',
  UPDATED: 'updated',
  DELETED: 'deleted'
}

class AuditLog {
  constructor() {
    this.collection = COLLECTION
  }

  // Índices para consultas rápidas del panel de auditoría (solo admin).
  async ensureIndexes() {
    try {
      await db.collection(COLLECTION).createIndexes([
        { key: { entity: 1, entityId: 1, createdAt: -1 }, name: 'entity_entityId_createdAt' },
        { key: { 'actor.userId': 1, createdAt: -1 }, name: 'actor_createdAt' },
        { key: { action: 1, createdAt: -1 }, name: 'action_createdAt' },
        { key: { createdAt: -1 }, name: 'createdAt_desc' }
      ])
      console.log('✅ Índices de auditLogs verificados')
    } catch (error) {
      console.error('Error al crear índices de auditLogs:', error)
    }
  }

  // Registra un movimiento. Acepta tanto la forma nueva ({ actor, entityLabel,
  // snapshot }) como la anterior ({ userId, userName }) para no romper los
  // llamados existentes.
  // El historial nunca debe tumbar la operación principal si falla el registro.
  async record({ entity, entityId, entityLabel, action, actor, userId, userName, changes, snapshot, meta }) {
    try {
      const resolvedActor = actor
        ? actorFrom(actor)
        : {
            userId: userId ? String(userId) : null,
            name: userName || null,
            email: null,
            role: null
          }

      const normalizedChanges = Array.isArray(changes) && changes.length ? changes : null

      await db.collection(COLLECTION).insertOne({
        entity: entity || null,
        entityId: entityId != null ? String(entityId) : null,
        entityLabel: entityLabel || null,
        action: action || null,
        actor: resolvedActor,
        // Se conservan a nivel raíz por compatibilidad con lectores previos.
        userId: resolvedActor.userId,
        userName: resolvedActor.name,
        changes: normalizedChanges,
        snapshot: snapshot ? sanitize(snapshot) : null,
        meta: meta || null,
        createdAt: new Date()
      })
    } catch (error) {
      console.error('Error al registrar auditLog:', error)
    }
  }

  // Historial de un registro concreto (contrato, pago, vendedor...).
  // Paginado: por defecto los 50 movimientos más recientes. Devuelve { items, total }.
  async getByEntity(entity, entityId, { limit = 50, skip = 0 } = {}) {
    try {
      const query = { entity, entityId: String(entityId) }
      const coll = db.collection(COLLECTION)
      const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200)
      const safeSkip = Math.max(Number(skip) || 0, 0)

      const [items, total] = await Promise.all([
        coll.find(query).sort({ createdAt: -1 }).skip(safeSkip).limit(safeLimit).toArray(),
        coll.countDocuments(query)
      ])

      return { items, total, limit: safeLimit, skip: safeSkip }
    } catch (error) {
      throw Boom.badImplementation('Error al obtener el historial', error)
    }
  }

  // Bitácora global con filtros y paginación (panel de auditoría del admin).
  async getAll({ entity, entityId, actorId, action, from, to, search, page = 1, limit = 50 } = {}) {
    try {
      const query = {}
      if (entity) query.entity = entity
      if (entityId) query.entityId = String(entityId)
      if (action) query.action = action
      // actor.userId (registros nuevos) o userId a nivel raíz (registros previos)
      if (actorId) {
        query.$and = [{ $or: [{ 'actor.userId': String(actorId) }, { userId: String(actorId) }] }]
      }

      if (from || to) {
        query.createdAt = {}
        if (from) {
          const fromDate = new Date(from)
          if (!Number.isNaN(fromDate.getTime())) query.createdAt.$gte = fromDate
        }
        if (to) {
          const toDate = new Date(to)
          if (!Number.isNaN(toDate.getTime())) query.createdAt.$lte = toDate
        }
        if (Object.keys(query.createdAt).length === 0) delete query.createdAt
      }

      if (search) {
        const rx = new RegExp(escapeRegex(search), 'i')
        query.$or = [
          { entityLabel: rx },
          { entity: rx },
          { action: rx },
          { 'actor.name': rx },
          { 'actor.email': rx },
          { userName: rx }
        ]
      }

      const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200)
      const safePage = Math.max(Number(page) || 1, 1)
      const skip = (safePage - 1) * safeLimit

      const coll = db.collection(COLLECTION)
      const [items, total] = await Promise.all([
        coll.find(query).sort({ createdAt: -1 }).skip(skip).limit(safeLimit).toArray(),
        coll.countDocuments(query)
      ])

      return {
        items,
        total,
        page: safePage,
        limit: safeLimit,
        pages: Math.ceil(total / safeLimit) || 1
      }
    } catch (error) {
      throw Boom.badImplementation('Error al obtener la bitácora de auditoría', error)
    }
  }

  // Valores disponibles para poblar los filtros del panel de auditoría.
  async getFilterOptions() {
    try {
      const coll = db.collection(COLLECTION)
      const [actions, entities, actors] = await Promise.all([
        coll.distinct('action'),
        coll.distinct('entity'),
        coll.aggregate([
          // Coalesce con los campos a nivel raíz para incluir registros previos
          // a la introducción del sub-documento `actor`.
          {
            $addFields: {
              _actorId: { $ifNull: ['$actor.userId', '$userId'] },
              _actorName: { $ifNull: ['$actor.name', '$userName'] }
            }
          },
          { $match: { _actorId: { $ne: null } } },
          {
            $group: {
              _id: '$_actorId',
              name: { $last: '$_actorName' },
              email: { $last: '$actor.email' },
              role: { $last: '$actor.role' }
            }
          },
          { $sort: { name: 1 } }
        ]).toArray()
      ])

      return {
        actions: actions.filter(Boolean).sort(),
        entities: entities.filter(Boolean).sort(),
        actors: actors.map((a) => ({ userId: a._id, name: a.name, email: a.email, role: a.role }))
      }
    } catch (error) {
      throw Boom.badImplementation('Error al obtener opciones de auditoría', error)
    }
  }
}

export default AuditLog
