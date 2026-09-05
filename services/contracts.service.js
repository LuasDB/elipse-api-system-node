import { ObjectId } from 'mongodb'
import { db, client } from './../db/mongoClient.js'
import Boom from '@hapi/boom'
import AuditLog from './auditLog.service.js'
import { diff } from '../utils/audit.util.js'

class Contracts {
  constructor() {
    this.collection = 'contracts'
    this.auditLog = new AuditLog()
  }

  
  // Valida y normaliza milestones de Línea 2
  validateAndNormalizeMilestones(milestones) {
    if (!Array.isArray(milestones) || milestones.length === 0) {
      throw Boom.badRequest('Debes proporcionar al menos un hito de obra')
    }

    const normalized = []

    milestones.forEach((m, idx) => {
      if (!m.name?.trim()) throw Boom.badRequest(`Hito ${idx + 1}: nombre requerido`)
      if (!m.amount || Number(m.amount) <= 0) throw Boom.badRequest(`Hito ${idx + 1}: monto inválido`)
      if (!m.commitmentDate) throw Boom.badRequest(`Hito ${idx + 1}: fecha compromiso de entrega requerida`)

      const commitmentDate = new Date(m.commitmentDate)
      if (isNaN(commitmentDate.getTime())) {
        throw Boom.badRequest(`Hito ${idx + 1}: fecha compromiso inválida`)
      }

      normalized.push({
        name: m.name.trim(),
        amount: Number(m.amount),
        commitmentDate,
        order: idx + 1
      })
    })

    return normalized
  }

  // Mapea el estado del contrato al estado correspondiente de la unidad
  getUnitStatusFromContract(contractStatus) {
    const map = {
      promesa: 'apartada',
      definitivo: 'en_escrituracion',
      escriturado: 'vendida',
      entregado: 'entregada',
      cancelado: 'disponible'
    }
    return map[contractStatus] || null
  }

  async create(data, context) {
    try {
      const { projectId, unitId, buyerId, sellerId, modality } = data

      if (!ObjectId.isValid(projectId)) throw Boom.badData('Proyecto no válido')
      if (!ObjectId.isValid(unitId)) throw Boom.badData('Unidad no válida')
      if (!ObjectId.isValid(buyerId)) throw Boom.badData('Comprador no válido')

      // Validar relaciones
      const buyer = await db.collection('buyers').findOne({ _id: new ObjectId(buyerId) })
      if (!buyer) throw Boom.notFound('Comprador no encontrado')

      const unit = await db.collection('units').findOne({ _id: new ObjectId(unitId) })
      if (!unit) throw Boom.notFound('Unidad no encontrada')
      if (unit.status !== 'disponible') {
        throw Boom.conflict(`La unidad "${unit.identifier}" no está disponible (estado actual: ${unit.status}). No se puede crear otro contrato sobre ella.`)
      }

      // Validar tipo de cambio
      const exchangeRate = Number(data.exchangeRate)
      if (!exchangeRate || exchangeRate <= 0) {
        throw Boom.badData('El tipo de cambio (USD a MXN) es requerido y debe ser mayor a 0')
      }

      // Validar modalidad
      const contractModality = modality || 'monthly'
      if (!['monthly', 'milestones'].includes(contractModality)) {
        throw Boom.badData('Modalidad no válida (debe ser monthly o milestones)')
      }

      // Si es modalidad por hitos, validar y normalizar
      let milestonesTemplate = []
      if (contractModality === 'milestones') {
        milestonesTemplate = this.validateAndNormalizeMilestones(data.milestonesTemplate || [])
      }

      const contract = {
        ...data,
        contractNumber: data.contractNumber || await this.generateContractNumber(projectId),
        // Modalidad
        modality: contractModality,
        milestonesTemplate,
        // Montos en USD (moneda fuente)
        salePrice: Number(data.salePrice) || 0,
        downPayment: Number(data.downPayment) || 0,
        monthlyPayment: Number(data.monthlyPayment) || 0,
        totalPayments: Number(data.totalPayments) || 0,
        currency: 'USD',
        // Tipo de cambio del contrato
        exchangeRate,
        exchangeRateDate: data.exchangeRateDate ? new Date(data.exchangeRateDate) : new Date(),
        status: data.status || 'promesa',
        // Snapshots para referencia rápida
        buyerName: buyer.name,
        unitIdentifier: unit.identifier,
        signatures: data.signatures || [],
        createdAt: new Date(),
        updatedAt: new Date()
      }

      const result = await db.collection(this.collection).insertOne(contract)

      // Actualizar estado de la unidad según contrato
      const unitStatus = this.getUnitStatusFromContract(contract.status)
      if (unitStatus) {
        await db.collection('units').updateOne(
          { _id: new ObjectId(unitId) },
          { $set: { status: unitStatus, updatedAt: new Date() } }
        )
      }

      // Auto-generar calendario de pagos
      try {
        const { default: PaymentsService } = await import('./payments.service.js')
        const paymentsService = new PaymentsService()
        await paymentsService.generateSchedule(result.insertedId.toString(), context)
      } catch (genErr) {
        console.error('Error al auto-generar calendario:', genErr)
      }

      await this.auditLog.record({
        entity: 'contract',
        entityId: result.insertedId,
        entityLabel: contract.contractNumber,
        action: 'created',
        actor: context?.actor,
        snapshot: { _id: result.insertedId, ...contract },
        meta: context ? { ip: context.ip } : null
      })

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
      if (filters.status) {
        query.status = filters.status
      } else if (!filters.includeCancelled) {
        // Los contratos cancelados no aparecen en listados generales: solo se
        // ven si se filtra explícitamente por status=cancelado o se pide includeCancelled.
        query.status = { $ne: 'cancelado' }
      }
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

  async getSellerId(id) {
    try {
      if (!ObjectId.isValid(id)) throw Boom.badRequest('El ID del contrato no es válido')
      const contract = await db.collection(this.collection).findOne(
        { _id: new ObjectId(id) },
        { projection: { sellerId: 1 } }
      )
      if (!contract) throw Boom.notFound(`No se encontró el contrato con ID ${id}`)
      return contract.sellerId
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener el contrato', error)
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

      const commissions = await db.collection('commissions').find({ contractId: id }).sort({ createdAt: 1 }).toArray()

      return { ...contract, buyer, unit, project, seller, commissions }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener el contrato', error)
    }
  }

  async updateOneById(id, newData, context) {
    try {
      if (!ObjectId.isValid(id)) throw Boom.badRequest('ID no válido')

      const existing = await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
      if (!existing) throw Boom.notFound('Contrato no encontrado')

      if (existing.status === 'cancelado') {
        throw Boom.badRequest('El contrato está cancelado y no se puede editar')
      }

      const { _id, buyer, unit, project, seller, projectName, ...dataToUpdate } = newData
      dataToUpdate.updatedAt = new Date()

      // Cancelar (o "descancelar") un contrato solo se hace por el endpoint dedicado
      // (contraseña + motivo obligatorios), nunca por la edición genérica.
      if (dataToUpdate.status === 'cancelado') {
        throw Boom.badRequest('Para cancelar un contrato usa la acción "Cancelar contrato"')
      }

      // Convertir numéricos
      const numericFields = ['salePrice', 'downPayment', 'monthlyPayment', 'totalPayments', 'exchangeRate']
      numericFields.forEach(field => {
        if (dataToUpdate[field] !== undefined) dataToUpdate[field] = Number(dataToUpdate[field]) || 0
      })

      // Validar TC si se está actualizando
      if (dataToUpdate.exchangeRate !== undefined && dataToUpdate.exchangeRate <= 0) {
        throw Boom.badData('El tipo de cambio debe ser mayor a 0')
      }

      // Convertir fecha del TC
      if (dataToUpdate.exchangeRateDate) {
        dataToUpdate.exchangeRateDate = new Date(dataToUpdate.exchangeRateDate)
      }

      // Si cambia modalidad o hitos, validar
      if (dataToUpdate.modality && !['monthly', 'milestones'].includes(dataToUpdate.modality)) {
        throw Boom.badData('Modalidad no válida')
      }

      const finalModality = dataToUpdate.modality || existing.modality || 'monthly'
      if (finalModality === 'milestones' && dataToUpdate.milestonesTemplate !== undefined) {
        dataToUpdate.milestonesTemplate = this.validateAndNormalizeMilestones(dataToUpdate.milestonesTemplate)
      }

      // Detectar si es necesario regenerar pagos (cambio de modalidad o de hitos)
      const modalityChanged = dataToUpdate.modality && dataToUpdate.modality !== existing.modality
      const milestonesChanged = finalModality === 'milestones' &&
        dataToUpdate.milestonesTemplate !== undefined &&
        JSON.stringify(dataToUpdate.milestonesTemplate) !== JSON.stringify(existing.milestonesTemplate || [])

      // Detectar cambios que requieren regeneración del calendario.
      // OJO: comparar el VALOR contra `existing`, no solo si la llave viene en el payload —
      // el formulario de edición reenvía siempre todos los campos (incluidos signDate/promiseDate
      // sin cambios), así que solo checar presencia disparaba regeneración en cualquier edición.
      const valueChanged = (field) =>
        field in dataToUpdate && String(dataToUpdate[field] ?? '') !== String(existing[field] ?? '')
      const triggersRegeneration = ['salePrice', 'downPayment', 'monthlyPayment', 'totalPayments', 'signDate', 'promiseDate']
      const shouldRegenerate = modalityChanged || milestonesChanged || triggersRegeneration.some(valueChanged)

      // Aplicar update
      await db.collection(this.collection).updateOne(
        { _id: new ObjectId(id) },
        { $set: { ...dataToUpdate, updatedAt: new Date() } }
      )

      const changes = diff(existing, dataToUpdate)
      if (changes.length) {
        await this.auditLog.record({
          entity: 'contract',
          entityId: id,
          entityLabel: existing.contractNumber,
          action: 'updated',
          actor: context?.actor,
          changes,
          meta: context ? { ip: context.ip } : null
        })
      }

      // Regenerar calendario si aplica (preservando pagos cobrados)
      let regenerationResult = null
      if (shouldRegenerate) {
        try {
          const { default: PaymentsService } = await import('./payments.service.js')
          const paymentsService = new PaymentsService()
          regenerationResult = await paymentsService.regenerateSchedulePreservingPaid(id, context)
        } catch (regenErr) {
          console.error('Error al regenerar calendario:', regenErr)
        }
      }

      const updated = await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
      return {
        ...updated,
        regenerated: !!regenerationResult,
        regenerationStats: regenerationResult || null
      }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al actualizar el contrato', error)
    }
  }

  // Cambia la unidad de un contrato existente: libera la unidad anterior (vuelve
  // a 'disponible') y reserva la nueva con el estado que le corresponda según el
  // estatus actual del contrato. Todo en una transacción — o se mueven las dos
  // unidades y el contrato, o no se toca nada.
  async changeUnit(id, newUnitId, context) {
    try {
      if (!ObjectId.isValid(id)) throw Boom.badRequest('ID de contrato no válido')
      if (!ObjectId.isValid(newUnitId)) throw Boom.badData('Unidad no válida')

      const contract = await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
      if (!contract) throw Boom.notFound('Contrato no encontrado')
      if (contract.status === 'cancelado') {
        throw Boom.badRequest('El contrato está cancelado y no se puede editar')
      }

      const oldUnitId = contract.unitId
      if (!oldUnitId || !ObjectId.isValid(oldUnitId)) {
        throw Boom.badImplementation('El contrato no tiene una unidad válida asignada')
      }
      if (String(oldUnitId) === String(newUnitId)) {
        throw Boom.badRequest('La unidad seleccionada es la misma que ya tiene el contrato')
      }

      const newUnit = await db.collection('units').findOne({ _id: new ObjectId(newUnitId) })
      if (!newUnit) throw Boom.notFound('La nueva unidad no existe')
      if (newUnit.status !== 'disponible') {
        throw Boom.conflict(`La unidad "${newUnit.identifier}" no está disponible (estado actual: ${newUnit.status}). No se puede asignar al contrato.`)
      }

      const oldUnit = await db.collection('units').findOne({ _id: new ObjectId(oldUnitId) })
      const newUnitStatus = this.getUnitStatusFromContract(contract.status) || 'apartada'

      const session = client.startSession()
      try {
        await session.withTransaction(async () => {
          await db.collection('units').updateOne(
            { _id: new ObjectId(oldUnitId) },
            { $set: { status: 'disponible', buyerId: null, updatedAt: new Date() } },
            { session }
          )
          await db.collection('units').updateOne(
            { _id: new ObjectId(newUnitId) },
            { $set: { status: newUnitStatus, buyerId: contract.buyerId || null, updatedAt: new Date() } },
            { session }
          )
          await db.collection(this.collection).updateOne(
            { _id: new ObjectId(id) },
            { $set: { unitId: String(newUnitId), unitIdentifier: newUnit.identifier, updatedAt: new Date() } },
            { session }
          )
        })
      } finally {
        await session.endSession()
      }

      await this.auditLog.record({
        entity: 'contract',
        entityId: id,
        entityLabel: contract.contractNumber,
        action: 'unit_changed',
        actor: context?.actor,
        changes: [
          { field: 'unitId', from: String(oldUnitId), to: String(newUnitId) },
          { field: 'unitIdentifier', from: contract.unitIdentifier || oldUnit?.identifier || null, to: newUnit.identifier }
        ],
        meta: {
          ip: context?.ip || null,
          oldUnit: { id: String(oldUnitId), identifier: oldUnit?.identifier || contract.unitIdentifier || null, releasedTo: 'disponible' },
          newUnit: { id: String(newUnitId), identifier: newUnit.identifier, setTo: newUnitStatus }
        }
      })

      return await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al cambiar la unidad del contrato', error)
    }
  }

  // Cancela un contrato: NO se borra nada (pagos y comisiones se conservan tal
  // cual, como histórico consultable en el detalle). Libera la unidad (vuelve
  // a 'disponible') y marca el contrato como 'cancelado' con motivo y quién lo hizo.
  // A partir de aquí el contrato queda congelado (updateOneById/changeUnit lo rechazan)
  // y se excluye de los cálculos de dashboard/reportes y de los listados generales.
  //
  // Es una acción sensible: la ruta la protege con `requirePassword`, que además
  // deja `context.confirmedWithPassword = true`.
  async cancelContract(id, reason, context) {
    try {
      if (!ObjectId.isValid(id)) throw Boom.badRequest('El ID del contrato no es válido')
      if (!reason || !reason.trim()) throw Boom.badData('El motivo de cancelación es requerido')

      const contract = await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
      if (!contract) throw Boom.notFound(`No se encontró el contrato con ID ${id}`)
      if (contract.status === 'cancelado') throw Boom.badRequest('El contrato ya está cancelado')

      const unitId = contract.unitId && ObjectId.isValid(contract.unitId)
        ? new ObjectId(contract.unitId)
        : null

      const cancelledAt = new Date()
      const cancelledBy = context?.actor?.name || context?.actor?.email || null
      let unitReleased = false

      const session = client.startSession()
      try {
        await session.withTransaction(async () => {
          await db.collection(this.collection).updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                status: 'cancelado',
                cancelReason: reason.trim(),
                cancelledAt,
                cancelledBy,
                updatedAt: cancelledAt
              }
            },
            { session }
          )
          if (unitId) {
            const r = await db.collection('units').updateOne(
              { _id: unitId },
              { $set: { status: 'disponible', buyerId: null, updatedAt: cancelledAt } },
              { session }
            )
            unitReleased = r.matchedCount > 0
          }
        })
      } finally {
        await session.endSession()
      }

      const confirmedWithPassword = context?.confirmedWithPassword || false

      await this.auditLog.record({
        entity: 'contract',
        entityId: id,
        entityLabel: contract.contractNumber,
        action: 'cancelled',
        actor: context?.actor,
        changes: [{ field: 'status', from: contract.status, to: 'cancelado' }],
        meta: { ip: context?.ip || null, reason: reason.trim(), confirmedWithPassword, unitReleased }
      })

      return await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al cancelar el contrato', error)
    }
  }

  async addFiles(id, files, context) {
  try {
    if (!ObjectId.isValid(id)) throw Boom.badRequest('El ID del contrato no es válido')

    const contract = await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
    if (!contract) throw Boom.notFound(`No se encontró el contrato con ID ${id}`)
    if (contract.status === 'cancelado') throw Boom.badRequest('El contrato está cancelado y no se puede editar')

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

    await this.auditLog.record({
      entity: 'contract',
      entityId: id,
      entityLabel: contract.contractNumber,
      action: 'file_added',
      actor: context?.actor,
      meta: { ip: context?.ip || null, files: fileRecords.map(f => f.originalName) }
    })

    return { filesAdded: fileRecords.length, files: fileRecords }
  } catch (error) {
    if (Boom.isBoom(error)) throw error
    throw Boom.badImplementation('Error al agregar archivos', error)
  }
}

async removeFile(id, fileName, context) {
  try {
    if (!ObjectId.isValid(id)) throw Boom.badRequest('El ID del contrato no es válido')

    const contract = await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
    if (!contract) throw Boom.notFound(`No se encontró el contrato con ID ${id}`)
    if (contract.status === 'cancelado') throw Boom.badRequest('El contrato está cancelado y no se puede editar')

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

    await this.auditLog.record({
      entity: 'contract',
      entityId: id,
      entityLabel: contract?.contractNumber,
      action: 'file_removed',
      actor: context?.actor,
      meta: { ip: context?.ip || null, fileName }
    })

    return result
  } catch (error) {
    if (Boom.isBoom(error)) throw error
    throw Boom.badImplementation('Error al eliminar archivo', error)
  }
}
}

export default Contracts
