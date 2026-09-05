import { ObjectId } from 'mongodb'
import { db } from './../db/mongoClient.js'
import Boom from '@hapi/boom'
import AuditLog from './auditLog.service.js'
import { diff } from '../utils/audit.util.js'

const LOCKED_STATUSES = ['entregado', 'cancelado']

class Commissions {
  constructor() {
    this.collection = 'commissions'
    this.auditLog = new AuditLog()
  }

  // Un contrato cancelado queda congelado: su comisión no se puede quitar,
  // recibir pagos, editarlos, eliminarlos, ni recibir nuevos comprobantes.
  async _assertContractNotCancelled(contractId) {
    if (!contractId || !ObjectId.isValid(contractId)) return
    const contract = await db.collection('contracts').findOne(
      { _id: new ObjectId(contractId) },
      { projection: { status: 1 } }
    )
    if (contract?.status === 'cancelado') {
      throw Boom.badRequest('El contrato está cancelado, no se puede modificar su comisión')
    }
  }

  validateAmountAndDescription({ amount, description } = {}) {
    const value = Number(amount)
    if (isNaN(value) || value <= 0) {
      throw Boom.badData('El monto de la comisión debe ser un número mayor a 0')
    }
    if (!description || !description.trim()) {
      throw Boom.badData('La descripción de la comisión es requerida')
    }
    return { amount: value, description: description.trim() }
  }

  async addSeller(contractId, { sellerId, amount, description } = {}, context) {
    try {
      if (!ObjectId.isValid(contractId)) throw Boom.badRequest('ID de contrato no válido')
      if (!ObjectId.isValid(sellerId)) throw Boom.badRequest('ID de vendedor no válido')

      const contract = await db.collection('contracts').findOne({ _id: new ObjectId(contractId) })
      if (!contract) throw Boom.notFound('Contrato no encontrado')

      if (LOCKED_STATUSES.includes(contract.status)) {
        throw Boom.forbidden(`No se puede asignar comisión: el contrato ya está en estado "${contract.status}"`)
      }

      const seller = await db.collection('users').findOne({ _id: new ObjectId(sellerId), role: 'vendedor' })
      if (!seller) throw Boom.badData('El vendedor seleccionado no existe o no tiene rol de vendedor')

      const existing = await db.collection(this.collection).findOne({ contractId, sellerId })
      if (existing) throw Boom.conflict('Este vendedor ya tiene una comisión asignada en este contrato')

      const { amount: value, description: desc } = this.validateAmountAndDescription({ amount, description })
      const now = new Date()

      const historyEntry = {
        amount: value,
        description: desc,
        changedAt: now,
        changedBy: context?.actor?.name || context?.actor?.email || null
      }

      const commission = {
        contractId,
        sellerId,
        projectId: contract.projectId,
        contractNumber: contract.contractNumber,
        buyerName: contract.buyerName,
        unitIdentifier: contract.unitIdentifier,
        sellerName: seller.name,
        amount: value,
        description: desc,
        paidAmount: 0,
        balance: value,
        status: 'pendiente',
        history: [historyEntry],
        movements: [],
        createdAt: now,
        updatedAt: now
      }

      const result = await db.collection(this.collection).insertOne(commission)

      await this.auditLog.record({
        entity: 'commission',
        entityId: result.insertedId,
        entityLabel: [contract.contractNumber, seller.name].filter(Boolean).join(' · '),
        action: 'commission_assigned',
        actor: context?.actor,
        snapshot: { _id: result.insertedId, ...commission },
        meta: { ip: context?.ip || null, contractId, sellerId, amount: value }
      })

      return { _id: result.insertedId, ...commission }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al asignar la comisión', error)
    }
  }

  async updateSeller(contractId, sellerId, { amount, description } = {}, context) {
    try {
      if (!ObjectId.isValid(contractId)) throw Boom.badRequest('ID de contrato no válido')

      const contract = await db.collection('contracts').findOne({ _id: new ObjectId(contractId) })
      if (!contract) throw Boom.notFound('Contrato no encontrado')

      if (LOCKED_STATUSES.includes(contract.status)) {
        throw Boom.forbidden(`No se puede modificar la comisión: el contrato ya está en estado "${contract.status}"`)
      }

      const existing = await db.collection(this.collection).findOne({ contractId, sellerId })
      if (!existing) throw Boom.notFound('No hay comisión asignada a este vendedor en este contrato')

      const { amount: value, description: desc } = this.validateAmountAndDescription({ amount, description })
      const now = new Date()

      const paidAmount = existing.paidAmount || 0
      const balance = Math.max(value - paidAmount, 0)
      const status = balance <= 0 && value > 0 ? 'pagado' : (paidAmount > 0 ? 'parcial' : 'pendiente')

      const historyEntry = {
        amount: value,
        description: desc,
        changedAt: now,
        changedBy: context?.actor?.name || context?.actor?.email || null
      }

      await db.collection(this.collection).updateOne(
        { _id: existing._id },
        {
          $set: {
            amount: value,
            description: desc,
            balance,
            status,
            updatedAt: now
          },
          $push: { history: historyEntry }
        }
      )

      const changes = diff(
        { amount: existing.amount, description: existing.description },
        { amount: value, description: desc }
      )
      if (changes.length) {
        await this.auditLog.record({
          entity: 'commission',
          entityId: existing._id,
          entityLabel: [existing.contractNumber, existing.sellerName].filter(Boolean).join(' · '),
          action: 'commission_updated',
          actor: context?.actor,
          changes,
          meta: { ip: context?.ip || null, contractId, sellerId }
        })
      }

      return await db.collection(this.collection).findOne({ _id: existing._id })
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al actualizar la comisión', error)
    }
  }

  async removeSeller(contractId, sellerId, context) {
    try {
      const existing = await db.collection(this.collection).findOne({ contractId, sellerId })
      if (!existing) throw Boom.notFound('No hay comisión asignada a este vendedor en este contrato')
      await this._assertContractNotCancelled(contractId)

      if (!context?.override && (existing.paidAmount || 0) > 0) {
        throw Boom.forbidden('No se puede quitar a este vendedor: ya tiene pagos de comisión registrados')
      }

      await db.collection(this.collection).deleteOne({ _id: existing._id })

      await this.auditLog.record({
        entity: 'commission',
        entityId: existing._id,
        entityLabel: [existing.contractNumber, existing.sellerName].filter(Boolean).join(' · '),
        action: 'commission_removed',
        actor: context?.actor,
        snapshot: existing,
        meta: { ip: context?.ip || null, contractId, sellerId }
      })

      return { removed: true, sellerId }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al quitar la comisión del vendedor', error)
    }
  }

  async getByContract(contractId) {
    try {
      const commissions = await db.collection(this.collection)
        .find({ contractId })
        .sort({ createdAt: 1 })
        .toArray()
      return commissions
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener las comisiones', error)
    }
  }

  async registerPayment(contractId, sellerId, { amount, paymentMethod, reference, notes, paymentDate, registeredBy } = {}, context) {
    try {
      const commission = await db.collection(this.collection).findOne({ contractId, sellerId })
      if (!commission) throw Boom.notFound('No hay comisión asignada para este vendedor en este contrato')
      await this._assertContractNotCancelled(contractId)

      const value = Number(amount)
      if (!value || value <= 0) throw Boom.badData('El monto debe ser mayor a 0')
      if (value > commission.balance) {
        throw Boom.badData('El monto excede el saldo pendiente de comisión')
      }

      const now = new Date()
      const newPaidAmount = commission.paidAmount + value
      const newBalance = Math.max(commission.amount - newPaidAmount, 0)
      const newStatus = newBalance <= 0 ? 'pagado' : 'parcial'

      const movement = {
        _id: new ObjectId(),
        amount: value,
        paymentMethod: paymentMethod || null,
        reference: reference || null,
        notes: notes || null,
        paymentDate: paymentDate ? new Date(paymentDate) : now,
        vouchers: [],
        registeredAt: now,
        registeredBy: registeredBy || null
      }

      await db.collection(this.collection).updateOne(
        { _id: commission._id },
        {
          $set: {
            paidAmount: newPaidAmount,
            balance: newBalance,
            status: newStatus,
            updatedAt: now
          },
          $push: { movements: movement }
        }
      )

      await this.auditLog.record({
        entity: 'commission',
        entityId: commission._id,
        entityLabel: [commission.contractNumber, commission.sellerName].filter(Boolean).join(' · '),
        action: 'commission_payment_registered',
        actor: context?.actor,
        changes: [
          { field: 'paidAmount', from: commission.paidAmount, to: newPaidAmount },
          { field: 'balance', from: commission.balance, to: newBalance },
          { field: 'status', from: commission.status, to: newStatus }
        ],
        meta: {
          ip: context?.ip || null,
          contractId,
          sellerId,
          movementId: String(movement._id),
          amount: value,
          paymentMethod: movement.paymentMethod,
          reference: movement.reference
        }
      })

      const updated = await db.collection(this.collection).findOne({ _id: commission._id })
      return { ...updated, movement }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al registrar el pago de comisión', error)
    }
  }

  async updateMovement(contractId, sellerId, movementId, updates = {}, context) {
    try {
      if (!ObjectId.isValid(movementId)) throw Boom.badRequest('ID de movimiento no válido')

      const commission = await db.collection(this.collection).findOne({ contractId, sellerId })
      if (!commission) throw Boom.notFound('No hay comisión asignada para este vendedor en este contrato')
      await this._assertContractNotCancelled(contractId)

      const movement = (commission.movements || []).find(m => String(m._id) === String(movementId))
      if (!movement) throw Boom.notFound('Movimiento de pago de comisión no encontrado')

      const newAmount = updates.amount !== undefined ? Number(updates.amount) : movement.amount
      if (!newAmount || newAmount <= 0) throw Boom.badData('El monto debe ser mayor a 0')

      const otherPaid = commission.paidAmount - movement.amount
      if (newAmount + otherPaid > commission.amount) {
        throw Boom.badData('El monto excede el saldo pendiente de comisión')
      }

      const now = new Date()
      const newPaidAmount = otherPaid + newAmount
      const newBalance = Math.max(commission.amount - newPaidAmount, 0)
      const newStatus = newBalance <= 0 && newPaidAmount > 0 ? 'pagado' : (newPaidAmount > 0 ? 'parcial' : 'pendiente')

      await db.collection(this.collection).updateOne(
        { _id: commission._id, 'movements._id': new ObjectId(movementId) },
        {
          $set: {
            'movements.$.amount': newAmount,
            'movements.$.paymentMethod': updates.paymentMethod ?? movement.paymentMethod,
            'movements.$.reference': updates.reference ?? movement.reference,
            'movements.$.notes': updates.notes ?? movement.notes,
            'movements.$.paymentDate': updates.paymentDate ? new Date(updates.paymentDate) : movement.paymentDate,
            'movements.$.editedAt': now,
            'movements.$.editedBy': context?.actor?.name || context?.actor?.email || null,
            paidAmount: newPaidAmount,
            balance: newBalance,
            status: newStatus,
            updatedAt: now
          }
        }
      )

      await this.auditLog.record({
        entity: 'commission',
        entityId: commission._id,
        entityLabel: [commission.contractNumber, commission.sellerName].filter(Boolean).join(' · '),
        action: 'commission_payment_updated',
        actor: context?.actor,
        changes: diff(
          { amount: movement.amount, paymentMethod: movement.paymentMethod, reference: movement.reference, notes: movement.notes },
          { amount: newAmount, paymentMethod: updates.paymentMethod ?? movement.paymentMethod, reference: updates.reference ?? movement.reference, notes: updates.notes ?? movement.notes }
        ),
        meta: { ip: context?.ip || null, contractId, sellerId, movementId }
      })

      return await db.collection(this.collection).findOne({ _id: commission._id })
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al actualizar el pago de comisión', error)
    }
  }

  async removeMovement(contractId, sellerId, movementId, context) {
    try {
      if (!ObjectId.isValid(movementId)) throw Boom.badRequest('ID de movimiento no válido')

      const commission = await db.collection(this.collection).findOne({ contractId, sellerId })
      if (!commission) throw Boom.notFound('No hay comisión asignada para este vendedor en este contrato')
      await this._assertContractNotCancelled(contractId)

      const movement = (commission.movements || []).find(m => String(m._id) === String(movementId))
      if (!movement) throw Boom.notFound('Movimiento de pago de comisión no encontrado')

      const now = new Date()
      const newPaidAmount = Math.max(commission.paidAmount - movement.amount, 0)
      const newBalance = Math.max(commission.amount - newPaidAmount, 0)
      const newStatus = newBalance <= 0 && newPaidAmount > 0 ? 'pagado' : (newPaidAmount > 0 ? 'parcial' : 'pendiente')

      await db.collection(this.collection).updateOne(
        { _id: commission._id },
        {
          $pull: { movements: { _id: new ObjectId(movementId) } },
          $set: { paidAmount: newPaidAmount, balance: newBalance, status: newStatus, updatedAt: now }
        }
      )

      const fs = await import('fs')
      for (const v of (movement.vouchers || [])) {
        const filePath = `uploads/commissions/${contractId}/${sellerId}/${v.fileName}`
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      }

      await this.auditLog.record({
        entity: 'commission',
        entityId: commission._id,
        entityLabel: [commission.contractNumber, commission.sellerName].filter(Boolean).join(' · '),
        action: 'commission_payment_removed',
        actor: context?.actor,
        snapshot: movement,
        changes: [
          { field: 'paidAmount', from: commission.paidAmount, to: newPaidAmount },
          { field: 'balance', from: commission.balance, to: newBalance },
          { field: 'status', from: commission.status, to: newStatus }
        ],
        meta: { ip: context?.ip || null, contractId, sellerId, movementId, amount: movement.amount }
      })

      return await db.collection(this.collection).findOne({ _id: commission._id })
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al eliminar el pago de comisión', error)
    }
  }

  async addVoucherToMovement(contractId, sellerId, movementId, files, context) {
    try {
      if (!ObjectId.isValid(movementId)) throw Boom.badRequest('ID de movimiento no válido')

      const commission = await db.collection(this.collection).findOne({ contractId, sellerId, 'movements._id': new ObjectId(movementId) })
      if (!commission) throw Boom.notFound('Movimiento de pago de comisión no encontrado')
      await this._assertContractNotCancelled(contractId)

      const vouchers = files.map(file => ({
        originalName: file.originalname,
        fileName: file.filename,
        path: file.path,
        size: file.size,
        mimetype: file.mimetype,
        uploadedAt: new Date()
      }))

      await db.collection(this.collection).updateOne(
        { contractId, sellerId, 'movements._id': new ObjectId(movementId) },
        {
          $push: { 'movements.$.vouchers': { $each: vouchers } },
          $set: { updatedAt: new Date() }
        }
      )

      await this.auditLog.record({
        entity: 'commission',
        entityId: commission._id,
        entityLabel: [commission.contractNumber, commission.sellerName].filter(Boolean).join(' · '),
        action: 'commission_voucher_added',
        actor: context?.actor,
        meta: { ip: context?.ip || null, contractId, sellerId, movementId, files: vouchers.map(v => v.originalName) }
      })

      return { added: vouchers.length, vouchers }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al agregar comprobantes de comisión', error)
    }
  }

  async removeVoucherFromMovement(contractId, sellerId, movementId, fileName, context) {
    try {
      if (!ObjectId.isValid(movementId)) throw Boom.badRequest('ID de movimiento no válido')

      const commission = await db.collection(this.collection).findOne({ contractId, sellerId })
      await this._assertContractNotCancelled(contractId)

      await db.collection(this.collection).updateOne(
        { contractId, sellerId, 'movements._id': new ObjectId(movementId) },
        {
          $pull: { 'movements.$.vouchers': { fileName } },
          $set: { updatedAt: new Date() }
        }
      )

      const filePath = `uploads/commissions/${contractId}/${sellerId}/${fileName}`
      const fs = await import('fs')
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }

      await this.auditLog.record({
        entity: 'commission',
        entityId: commission?._id,
        entityLabel: [commission?.contractNumber, commission?.sellerName].filter(Boolean).join(' · '),
        action: 'commission_voucher_removed',
        actor: context?.actor,
        meta: { ip: context?.ip || null, contractId, sellerId, movementId, fileName }
      })

      return { removed: fileName }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al eliminar comprobante de comisión', error)
    }
  }

  async getBySeller(sellerId) {
    try {
      const commissions = await db.collection(this.collection)
        .find({ sellerId })
        .sort({ createdAt: -1 })
        .toArray()
      return commissions
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener las comisiones del vendedor', error)
    }
  }

  // Pipeline compartido: adjunta el status del contrato para poder excluir
  // las comisiones de contratos cancelados de los totales (no cuentan en
  // los resúmenes de vendedores ni en el dashboard).
  _excludeCancelledContractsStages() {
    return [
      {
        $lookup: {
          from: 'contracts',
          let: { cid: '$contractId' },
          pipeline: [
            { $match: { $expr: { $eq: [{ $toString: '$_id' }, '$$cid'] } } },
            { $project: { status: 1 } }
          ],
          as: 'contract'
        }
      },
      { $unwind: { path: '$contract', preserveNullAndEmptyArrays: true } },
      { $match: { 'contract.status': { $ne: 'cancelado' } } }
    ]
  }

  async getSellerSummary(sellerId) {
    try {
      const result = await db.collection(this.collection).aggregate([
        { $match: { sellerId } },
        ...this._excludeCancelledContractsStages(),
        {
          $group: {
            _id: null,
            contractsCount: { $sum: 1 },
            totalAssigned: { $sum: '$amount' },
            totalPaid: { $sum: '$paidAmount' },
            totalPending: { $sum: '$balance' }
          }
        }
      ]).toArray()

      return result[0] || { contractsCount: 0, totalAssigned: 0, totalPaid: 0, totalPending: 0 }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener el resumen del vendedor', error)
    }
  }

  // Resumen global de comisiones (todos los vendedores, para el dashboard)
  async getTotalSummary() {
    try {
      const result = await db.collection(this.collection).aggregate([
        ...this._excludeCancelledContractsStages(),
        {
          $group: {
            _id: null,
            contractsCount: { $sum: 1 },
            totalAssigned: { $sum: '$amount' },
            totalPaid: { $sum: '$paidAmount' },
            totalPending: { $sum: '$balance' }
          }
        }
      ]).toArray()

      return result[0] || { contractsCount: 0, totalAssigned: 0, totalPaid: 0, totalPending: 0 }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener el resumen de comisiones', error)
    }
  }
}

export default Commissions
