import { ObjectId } from 'mongodb'
import { db } from './../db/mongoClient.js'
import Boom from '@hapi/boom'

const LOCKED_STATUSES = ['entregado', 'cancelado']

class Commissions {
  constructor() {
    this.collection = 'commissions'
  }

  async assign(contractId, { percentage, notes, assignedBy } = {}) {
    try {
      if (!ObjectId.isValid(contractId)) throw Boom.badRequest('ID de contrato no válido')

      const contract = await db.collection('contracts').findOne({ _id: new ObjectId(contractId) })
      if (!contract) throw Boom.notFound('Contrato no encontrado')

      if (!contract.sellerId) {
        throw Boom.badRequest('El contrato no tiene un vendedor asignado')
      }

      if (LOCKED_STATUSES.includes(contract.status)) {
        throw Boom.forbidden(`No se puede asignar comisión: el contrato ya está en estado "${contract.status}"`)
      }

      const pct = Number(percentage)
      if (isNaN(pct) || pct < 0 || pct > 100) {
        throw Boom.badData('El porcentaje de comisión debe ser un número entre 0 y 100')
      }

      const baseAmount = Number(contract.salePrice) || 0
      const commissionAmount = Math.round(baseAmount * pct / 100 * 100) / 100
      const now = new Date()

      const existing = await db.collection(this.collection).findOne({ contractId })

      const historyEntry = {
        percentage: pct,
        baseAmount,
        commissionAmount,
        notes: notes || null,
        changedAt: now,
        changedBy: assignedBy || null
      }

      if (existing) {
        const paidAmount = existing.paidAmount || 0
        const balance = Math.max(commissionAmount - paidAmount, 0)
        const status = balance <= 0 && commissionAmount > 0 ? 'pagado' : (paidAmount > 0 ? 'parcial' : 'pendiente')

        await db.collection(this.collection).updateOne(
          { _id: existing._id },
          {
            $set: {
              percentage: pct,
              baseAmount,
              commissionAmount,
              balance,
              status,
              sellerId: contract.sellerId,
              updatedAt: now
            },
            $push: { history: historyEntry }
          }
        )

        return await db.collection(this.collection).findOne({ _id: existing._id })
      }

      const commission = {
        contractId,
        sellerId: contract.sellerId,
        projectId: contract.projectId,
        contractNumber: contract.contractNumber,
        buyerName: contract.buyerName,
        unitIdentifier: contract.unitIdentifier,
        percentage: pct,
        baseAmount,
        commissionAmount,
        paidAmount: 0,
        balance: commissionAmount,
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

  async getByContract(contractId) {
    try {
      const commission = await db.collection(this.collection).findOne({ contractId })
      return commission || null
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener la comisión', error)
    }
  }

  async registerPayment(contractId, { amount, paymentMethod, reference, notes, paymentDate, registeredBy } = {}) {
    try {
      const commission = await db.collection(this.collection).findOne({ contractId })
      if (!commission) throw Boom.notFound('No hay comisión asignada para este contrato')

      const value = Number(amount)
      if (!value || value <= 0) throw Boom.badData('El monto debe ser mayor a 0')
      if (value > commission.balance) {
        throw Boom.badData('El monto excede el saldo pendiente de comisión')
      }

      const now = new Date()
      const newPaidAmount = commission.paidAmount + value
      const newBalance = Math.max(commission.commissionAmount - newPaidAmount, 0)
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

  async addVoucherToMovement(contractId, movementId, files) {
    try {
      if (!ObjectId.isValid(movementId)) throw Boom.badRequest('ID de movimiento no válido')

      const commission = await db.collection(this.collection).findOne({ contractId, 'movements._id': new ObjectId(movementId) })
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
        { contractId, 'movements._id': new ObjectId(movementId) },
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

  async removeVoucherFromMovement(contractId, movementId, fileName) {
    try {
      if (!ObjectId.isValid(movementId)) throw Boom.badRequest('ID de movimiento no válido')

      await db.collection(this.collection).updateOne(
        { contractId, 'movements._id': new ObjectId(movementId) },
        {
          $pull: { 'movements.$.vouchers': { fileName } },
          $set: { updatedAt: new Date() }
        }
      )

      const filePath = `uploads/commissions/${contractId}/${fileName}`
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
            totalAssigned: { $sum: '$commissionAmount' },
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
            totalAssigned: { $sum: '$commissionAmount' },
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
