import { ObjectId } from 'mongodb'
import { db } from './../db/mongoClient.js'
import Boom from '@hapi/boom'

const LOCKED_STATUSES = ['entregado', 'cancelado']

class Commissions {
  constructor() {
    this.collection = 'commissions'
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

  async addSeller(contractId, { sellerId, amount, description } = {}, actor) {
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
        changedBy: actor || null
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
      return { _id: result.insertedId, ...commission }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al asignar la comisión', error)
    }
  }

  async updateSeller(contractId, sellerId, { amount, description } = {}, actor) {
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
        changedBy: actor || null
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

      return await db.collection(this.collection).findOne({ _id: existing._id })
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al actualizar la comisión', error)
    }
  }

  async removeSeller(contractId, sellerId) {
    try {
      const existing = await db.collection(this.collection).findOne({ contractId, sellerId })
      if (!existing) throw Boom.notFound('No hay comisión asignada a este vendedor en este contrato')

      if ((existing.paidAmount || 0) > 0) {
        throw Boom.forbidden('No se puede quitar a este vendedor: ya tiene pagos de comisión registrados')
      }

      await db.collection(this.collection).deleteOne({ _id: existing._id })
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

  async registerPayment(contractId, sellerId, { amount, paymentMethod, reference, notes, paymentDate, registeredBy } = {}) {
    try {
      const commission = await db.collection(this.collection).findOne({ contractId, sellerId })
      if (!commission) throw Boom.notFound('No hay comisión asignada para este vendedor en este contrato')

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

      const updated = await db.collection(this.collection).findOne({ _id: commission._id })
      return { ...updated, movement }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al registrar el pago de comisión', error)
    }
  }

  async addVoucherToMovement(contractId, sellerId, movementId, files) {
    try {
      if (!ObjectId.isValid(movementId)) throw Boom.badRequest('ID de movimiento no válido')

      const commission = await db.collection(this.collection).findOne({ contractId, sellerId, 'movements._id': new ObjectId(movementId) })
      if (!commission) throw Boom.notFound('Movimiento de pago de comisión no encontrado')

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

      return { added: vouchers.length, vouchers }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al agregar comprobantes de comisión', error)
    }
  }

  async removeVoucherFromMovement(contractId, sellerId, movementId, fileName) {
    try {
      if (!ObjectId.isValid(movementId)) throw Boom.badRequest('ID de movimiento no válido')

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

  async getSellerSummary(sellerId) {
    try {
      const result = await db.collection(this.collection).aggregate([
        { $match: { sellerId } },
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
