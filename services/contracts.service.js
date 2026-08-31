import { ObjectId } from 'mongodb'
import { promises as fsp } from 'fs'
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

      const { _id, buyer, unit, project, seller, projectName, ...dataToUpdate } = newData
      dataToUpdate.updatedAt = new Date()

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

  // Baja total del contrato con cascada: borra pagos (incluidos los cobrados) y
  // comisiones + sus pagos, libera la unidad (vuelve a 'disponible') y elimina los
  // archivos en disco. Todo lo borrado queda con snapshot en la bitácora.
  //
  // Es una acción sensible: la ruta la protege con `requirePassword`, que además
  // deja `context.confirmedWithPassword = true`.
  async hardDeleteContract(id, context) {
    try {
      if (!ObjectId.isValid(id)) throw Boom.badRequest('El ID del contrato no es válido')

      const contract = await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
      if (!contract) throw Boom.notFound(`No se encontró el contrato con ID ${id}`)

      const unitId = contract.unitId && ObjectId.isValid(contract.unitId)
        ? new ObjectId(contract.unitId)
        : null

      let payments = []
      let commissions = []
      let unitReleased = false

      // Transacción: o se borra todo y se libera la unidad, o no se toca nada.
      // Las lecturas van dentro para que el snapshot sea exactamente lo borrado.
      const session = client.startSession()
      try {
        await session.withTransaction(async () => {
          payments = await db.collection('payments').find({ contractId: id }, { session }).toArray()
          commissions = await db.collection('commissions').find({ contractId: id }, { session }).toArray()

          await db.collection('payments').deleteMany({ contractId: id }, { session })
          await db.collection('commissions').deleteMany({ contractId: id }, { session })
          await db.collection(this.collection).deleteOne({ _id: new ObjectId(id) }, { session })
          if (unitId) {
            const r = await db.collection('units').updateOne(
              { _id: unitId },
              { $set: { status: 'disponible', buyerId: null, updatedAt: new Date() } },
              { session }
            )
            unitReleased = r.matchedCount > 0
          }
        })
      } finally {
        await session.endSession()
      }

      // A partir de aquí ya está confirmado en BD. La bitácora nunca debe tumbar
      // la operación (auditLog.record swallowea sus propios errores).
      const confirmedWithPassword = context?.confirmedWithPassword || false

      // 1) Registro maestro con el snapshot completo de lo eliminado.
      await this.auditLog.record({
        entity: 'contract',
        entityId: id,
        entityLabel: contract.contractNumber,
        action: 'contract_hard_deleted',
        actor: context?.actor,
        snapshot: { contract, payments, commissions },
        meta: {
          ip: context?.ip || null,
          confirmedWithPassword,
          unitReleased,
          cascade: { payments: payments.length, commissions: commissions.length }
        }
      })

      // 2) Un registro por entidad borrada, para que su historial propio
      //    (GET /audit/payment/:id, GET /audit/commission/:id) muestre la baja.
      for (const p of payments) {
        await this.auditLog.record({
          entity: 'payment',
          entityId: p._id,
          entityLabel: [p.concept, p.unitIdentifier].filter(Boolean).join(' · '),
          action: 'deleted',
          actor: context?.actor,
          snapshot: p,
          meta: { ip: context?.ip || null, contractId: id, reason: 'contract_hard_deleted', confirmedWithPassword }
        })
      }
      for (const c of commissions) {
        await this.auditLog.record({
          entity: 'commission',
          entityId: c._id,
          entityLabel: [c.contractNumber, c.sellerName].filter(Boolean).join(' · '),
          action: 'deleted',
          actor: context?.actor,
          snapshot: c,
          meta: { ip: context?.ip || null, contractId: id, reason: 'contract_hard_deleted', confirmedWithPassword }
        })
      }

      // 3) Limpieza de archivos en disco (no fatal).
      await this.cleanupContractFilesFromDisk(id, payments)

      return {
        deleted: { contract: 1, payments: payments.length, commissions: commissions.length },
        unitReleased
      }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al eliminar el contrato', error)
    }
  }

  // Borra los directorios de adjuntos asociados al contrato. Nunca lanza:
  // un archivo que no se pudo borrar no debe revertir la baja ya confirmada.
  async cleanupContractFilesFromDisk(contractId, payments = []) {
    const dirs = [
      `uploads/contracts/${contractId}`,
      `uploads/commissions/${contractId}`, // multer anida por /<sellerId> debajo
      ...payments.map((p) => `uploads/payments/${p._id}`)
    ]
    for (const dir of dirs) {
      try {
        await fsp.rm(dir, { recursive: true, force: true })
      } catch (err) {
        console.error(`No se pudo eliminar el directorio ${dir}:`, err.message)
      }
    }
  }

  async addFiles(id, files, context) {
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
