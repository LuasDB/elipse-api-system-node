import { ObjectId } from 'mongodb'
import { db } from './../db/mongoClient.js'
import Boom from '@hapi/boom'

class Payments {
  constructor() {
    this.collection = 'payments'
  }

  // Genera calendario completo de pagos al crear contrato
  async generateSchedule(contractId) {
    try {
      if (!ObjectId.isValid(contractId)) throw Boom.badRequest('ID de contrato no válido')

      const contract = await db.collection('contracts').findOne({ _id: new ObjectId(contractId) })
      if (!contract) throw Boom.notFound('Contrato no encontrado')

      // Verificar si ya tiene pagos
      const existing = await db.collection(this.collection).countDocuments({ contractId })
      if (existing > 0) throw Boom.conflict('Este contrato ya tiene un calendario de pagos generado')

      const payments = []
      const now = new Date()
      let paymentNumber = 1

      // Enganche
      if (contract.downPayment && contract.downPayment > 0) {
        payments.push({
          contractId,
          projectId: contract.projectId,
          unitId: contract.unitId,
          buyerId: contract.buyerId,
          buyerName: contract.buyerName,
          unitIdentifier: contract.unitIdentifier,
          paymentNumber,
          concept: 'Enganche',
          expectedAmount: contract.downPayment,
          paidAmount: 0,
          balance: contract.downPayment,
          currency: 'USD',
          contractExchangeRate: contract.exchangeRate || null,
          dueDate: contract.promiseDate ? new Date(contract.promiseDate) : now,
          paidDate: null,
          status: 'pendiente',
          paymentMethod: null,
          reference: null,
          notes: null,
          createdAt: now,
          updatedAt: now
        })
        paymentNumber++
      }

      // Mensualidades
      const totalPayments = Number(contract.totalPayments) || 0
      const monthlyAmount = Number(contract.monthlyPayment) || 0

      if (totalPayments > 0 && monthlyAmount > 0) {
        // Primera mensualidad un mes después del enganche o de la firma
        const baseDate = contract.promiseDate ? new Date(contract.promiseDate) : now

        for (let i = 0; i < totalPayments; i++) {
          const dueDate = new Date(baseDate)
          dueDate.setMonth(dueDate.getMonth() + i + 1)

          payments.push({
            contractId,
            projectId: contract.projectId,
            unitId: contract.unitId,
            buyerId: contract.buyerId,
            buyerName: contract.buyerName,
            unitIdentifier: contract.unitIdentifier,
            paymentNumber,
            concept: `Mensualidad ${i + 1} de ${totalPayments}`,
            expectedAmount: monthlyAmount,
            paidAmount: 0,
            balance: monthlyAmount,
            currency: 'USD',
            contractExchangeRate: contract.exchangeRate || null,
            dueDate,
            paidDate: null,
            status: 'pendiente',
            paymentMethod: null,
            reference: null,
            notes: null,
            createdAt: now,
            updatedAt: now
          })
          paymentNumber++
        }
      }

      if (payments.length === 0) {
        throw Boom.badRequest('El contrato no tiene datos suficientes para generar pagos (enganche o mensualidades)')
      }

      const result = await db.collection(this.collection).insertMany(payments)
      return { generated: payments.length, insertedIds: result.insertedIds }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al generar calendario de pagos', error)
    }
  }

  // Obtener pagos de un contrato
  async getByContract(contractId) {
    try {
      const payments = await db.collection(this.collection)
        .find({ contractId })
        .sort({ paymentNumber: 1 })
        .toArray()

      // Actualizar estados de vencimiento
      const now = new Date()
      const bulkOps = []

      payments.forEach(p => {
        if (p.status === 'pendiente' && new Date(p.dueDate) < now) {
          p.status = 'vencido'
          bulkOps.push({
            updateOne: {
              filter: { _id: p._id },
              update: { $set: { status: 'vencido', updatedAt: now } }
            }
          })
        }
      })

      if (bulkOps.length > 0) {
        await db.collection(this.collection).bulkWrite(bulkOps)
      }

      return payments
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener pagos', error)
    }
  }

  // Registrar un pago (total o parcial)
  async registerPayment(id, paymentData) {
    try {
      if (!ObjectId.isValid(id)) throw Boom.badRequest('ID de pago no válido')

      const payment = await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
      if (!payment) throw Boom.notFound('Pago no encontrado')
      if (payment.status === 'pagado') throw Boom.conflict('Este pago ya fue registrado como pagado')

      const amount = Number(paymentData.amount)
      if (!amount || amount <= 0) throw Boom.badData('El monto debe ser mayor a 0')

      // Validar TC del día del pago
      const exchangeRate = Number(paymentData.exchangeRate)
      if (!exchangeRate || exchangeRate <= 0) {
        throw Boom.badData('El tipo de cambio (USD a MXN) del día es requerido')
      }

      const newPaidAmount = payment.paidAmount + amount
      const newBalance = payment.expectedAmount - newPaidAmount
      const now = new Date()

      let newStatus = 'parcial'
      if (newBalance <= 0) {
        newStatus = 'pagado'
      }

      const updateData = {
        paidAmount: newPaidAmount,
        balance: Math.max(newBalance, 0),
        status: newStatus,
        paidDate: newStatus === 'pagado' ? now : payment.paidDate,
        paymentMethod: paymentData.paymentMethod || payment.paymentMethod,
        reference: paymentData.reference || payment.reference,
        notes: paymentData.notes || payment.notes,
        // Último TC usado en este pago
        lastExchangeRate: exchangeRate,
        lastExchangeRateDate: paymentData.exchangeRateDate ? new Date(paymentData.exchangeRateDate) : now,
        updatedAt: now
      }

      // Guardar en historial de movimientos (cada movimiento tiene su propio TC)
      const movement = {
        amount,
        currency: 'USD',
        exchangeRate,
        exchangeRateDate: paymentData.exchangeRateDate ? new Date(paymentData.exchangeRateDate) : now,
        mxnEquivalent: Math.round(amount * exchangeRate * 100) / 100,
        paymentMethod: paymentData.paymentMethod || null,
        reference: paymentData.reference || null,
        notes: paymentData.notes || null,
        registeredAt: now,
        registeredBy: paymentData.registeredBy || null
      }

      await db.collection(this.collection).updateOne(
        { _id: new ObjectId(id) },
        {
          $set: updateData,
          $push: { movements: movement }
        }
      )

      return { ...updateData, movement }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al registrar el pago', error)
    }
  }

  // Resumen financiero de un contrato
  async getContractSummary(contractId) {
    try {
      const payments = await db.collection(this.collection)
        .find({ contractId })
        .toArray()

      const summary = {
        totalExpected: 0,
        totalPaid: 0,
        totalBalance: 0,
        totalPayments: payments.length,
        paidCount: 0,
        pendingCount: 0,
        overdueCount: 0,
        partialCount: 0,
        nextPayment: null
      }

      const now = new Date()

      payments.forEach(p => {
        summary.totalExpected += p.expectedAmount
        summary.totalPaid += p.paidAmount
        summary.totalBalance += p.balance

        if (p.status === 'pagado') summary.paidCount++
        else if (p.status === 'vencido') summary.overdueCount++
        else if (p.status === 'parcial') summary.partialCount++
        else summary.pendingCount++
      })

      // Siguiente pago pendiente
      const nextPayment = payments
        .filter(p => p.status === 'pendiente' || p.status === 'vencido' || p.status === 'parcial')
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0]

      summary.nextPayment = nextPayment || null

      return summary
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener resumen', error)
    }
  }

  // Dashboard de alertas global
  async getAlerts() {
    try {
      const now = new Date()
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

      // Pagos vencidos (no pagados y fecha ya pasó)
      const overdue = await db.collection(this.collection)
        .find({
          status: { $in: ['pendiente', 'parcial', 'vencido'] },
          dueDate: { $lt: now }
        })
        .sort({ dueDate: 1 })
        .toArray()

      // Pagos del mes actual (pendientes)
      const dueThisMonth = await db.collection(this.collection)
        .find({
          status: { $in: ['pendiente', 'parcial'] },
          dueDate: { $gte: now, $lte: endOfMonth }
        })
        .sort({ dueDate: 1 })
        .toArray()

      // Próximos 30 días
      const next30 = new Date(now)
      next30.setDate(next30.getDate() + 30)

      const upcoming = await db.collection(this.collection)
        .find({
          status: { $in: ['pendiente'] },
          dueDate: { $gte: now, $lte: next30 }
        })
        .sort({ dueDate: 1 })
        .toArray()

      // Pagos recibidos este mes
      const paidThisMonth = await db.collection(this.collection)
        .find({
          status: 'pagado',
          paidDate: { $gte: startOfMonth, $lte: endOfMonth }
        })
        .toArray()

      const totalPaidThisMonth = paidThisMonth.reduce((sum, p) => sum + p.paidAmount, 0)
      const totalOverdue = overdue.reduce((sum, p) => sum + p.balance, 0)
      const totalDueThisMonth = dueThisMonth.reduce((sum, p) => sum + p.balance, 0)

      return {
        overdue: {
          count: overdue.length,
          total: totalOverdue,
          items: overdue.slice(0, 20)
        },
        dueThisMonth: {
          count: dueThisMonth.length,
          total: totalDueThisMonth,
          items: dueThisMonth.slice(0, 20)
        },
        upcoming: {
          count: upcoming.length,
          items: upcoming.slice(0, 10)
        },
        collected: {
          count: paidThisMonth.length,
          total: totalPaidThisMonth
        }
      }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener alertas', error)
    }
  }

  // Cobranza por periodo (totales agregados USD + MXN basados en movements)
  async getCollectionsByPeriod(startDate, endDate) {
    try {
      if (!startDate || !endDate) {
        throw Boom.badData('Las fechas de inicio y fin son requeridas')
      }

      const start = new Date(startDate)
      const end = new Date(endDate)

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw Boom.badData('Las fechas no son válidas')
      }

      if (start > end) {
        throw Boom.badData('La fecha de inicio no puede ser posterior a la fecha de fin')
      }

      // Aggregation: desplegamos todos los movements y filtramos por rango de fecha
      const result = await db.collection(this.collection).aggregate([
        { $match: { movements: { $exists: true, $ne: [] } } },
        { $unwind: '$movements' },
        {
          $match: {
            'movements.registeredAt': { $gte: start, $lte: end }
          }
        },
        {
          $group: {
            _id: null,
            totalUSD: { $sum: '$movements.amount' },
            totalMXN: { $sum: { $ifNull: ['$movements.mxnEquivalent', 0] } },
            movementsCount: { $sum: 1 },
            uniquePayments: { $addToSet: '$_id' },
            uniqueContracts: { $addToSet: '$contractId' }
          }
        },
        {
          $project: {
            _id: 0,
            totalUSD: { $round: ['$totalUSD', 2] },
            totalMXN: { $round: ['$totalMXN', 2] },
            movementsCount: 1,
            paymentsCount: { $size: '$uniquePayments' },
            contractsCount: { $size: '$uniqueContracts' }
          }
        }
      ]).toArray()

      const summary = result[0] || {
        totalUSD: 0,
        totalMXN: 0,
        movementsCount: 0,
        paymentsCount: 0,
        contractsCount: 0
      }

      // TC promedio ponderado del periodo (útil para mostrar referencia)
      const averageRate = summary.totalUSD > 0
        ? Math.round((summary.totalMXN / summary.totalUSD) * 10000) / 10000
        : 0

      return {
        period: {
          startDate: start,
          endDate: end
        },
        ...summary,
        averageExchangeRate: averageRate
      }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener cobranza del periodo', error)
    }
  }

  // Eliminar pago individual (solo si no está pagado)
  async deleteOneById(id) {
    try {
      if (!ObjectId.isValid(id)) throw Boom.badRequest('ID no válido')
      const payment = await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
      if (!payment) throw Boom.notFound('Pago no encontrado')
      if (payment.status === 'pagado') throw Boom.conflict('No se puede eliminar un pago ya registrado')

      const result = await db.collection(this.collection).deleteOne({ _id: new ObjectId(id) })
      return result
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al eliminar pago', error)
    }
  }

  // Eliminar todos los pagos de un contrato
  async deleteByContract(contractId) {
    try {
      const result = await db.collection(this.collection).deleteMany({ contractId })
      return result
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al eliminar pagos del contrato', error)
    }
  }

  async addVouchers(id, files) {
  try {
    if (!ObjectId.isValid(id)) throw Boom.badRequest('ID de pago no válido')

    const payment = await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
    if (!payment) throw Boom.notFound('Pago no encontrado')

    const vouchers = files.map(file => ({
      originalName: file.originalname,
      fileName: file.filename,
      path: file.path,
      size: file.size,
      mimetype: file.mimetype,
      uploadedAt: new Date()
    }))

    await db.collection(this.collection).updateOne(
      { _id: new ObjectId(id) },
      {
        $push: { vouchers: { $each: vouchers } },
        $set: { updatedAt: new Date() }
      }
    )

    return { added: vouchers.length, vouchers }
  } catch (error) {
    if (Boom.isBoom(error)) throw error
    throw Boom.badImplementation('Error al agregar comprobantes', error)
  }
}

async removeVoucher(id, fileName) {
  try {
    if (!ObjectId.isValid(id)) throw Boom.badRequest('ID de pago no válido')

    await db.collection(this.collection).updateOne(
      { _id: new ObjectId(id) },
      {
        $pull: { vouchers: { fileName } },
        $set: { updatedAt: new Date() }
      }
    )

    const filePath = `uploads/payments/${id}/${fileName}`
    const fs = await import('fs')
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    return { removed: fileName }
  } catch (error) {
    if (Boom.isBoom(error)) throw error
    throw Boom.badImplementation('Error al eliminar comprobante', error)
  }
}
}

export default Payments