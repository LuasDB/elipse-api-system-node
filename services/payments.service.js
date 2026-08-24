import { ObjectId } from 'mongodb'
import { db } from './../db/mongoClient.js'
import Boom from '@hapi/boom'
import AuditLog from './auditLog.service.js'

// Campos de un pago que el admin puede editar directamente (fuera del flujo normal de registro/hitos)
const EDITABLE_PAYMENT_FIELDS = [
  'concept', 'expectedAmount', 'paidAmount', 'balance', 'dueDate', 'paidDate',
  'status', 'paymentMethod', 'reference', 'notes'
]

class Payments {
  constructor() {
    this.collection = 'payments'
    this.auditLog = new AuditLog()
  }

  // Genera calendario completo de pagos al crear contrato
  async generateSchedule(contractId) {
    try {
      if (!ObjectId.isValid(contractId)) throw Boom.badRequest('ID de contrato no válido')

      const contract = await db.collection('contracts').findOne({ _id: new ObjectId(contractId) })
      if (!contract) throw Boom.notFound('Contrato no encontrado')

      // Borrar pagos previos del contrato (regeneración)
      await db.collection(this.collection).deleteMany({ contractId: contractId.toString() })

      const payments = []
      const now = new Date()
      let paymentNumber = 1

      const modality = contract.modality || 'monthly'

      // Enganche (común a ambas modalidades)
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
          // Campos de hito (no aplica al enganche)
          isMilestone: false,
          milestoneStatus: null,
          movements: [],
          createdAt: now,
          updatedAt: now
        })
        paymentNumber++
      }

      // === MODALIDAD MENSUALIDADES ===
      if (modality === 'monthly') {
        const totalPayments = Number(contract.totalPayments) || 0
        const monthlyAmount = Number(contract.monthlyPayment) || 0

        if (totalPayments > 0 && monthlyAmount > 0) {
          const startDate = contract.signDate ? new Date(contract.signDate) : now
          for (let i = 0; i < totalPayments; i++) {
            const dueDate = new Date(startDate)
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
              isMilestone: false,
              milestoneStatus: null,
              movements: [],
              createdAt: now,
              updatedAt: now
            })
            paymentNumber++
          }
        }
      }

      // === MODALIDAD POR HITOS DE OBRA ===
      if (modality === 'milestones') {
        const milestones = contract.milestonesTemplate || []
        for (const m of milestones) {
          payments.push({
            contractId,
            projectId: contract.projectId,
            unitId: contract.unitId,
            buyerId: contract.buyerId,
            buyerName: contract.buyerName,
            unitIdentifier: contract.unitIdentifier,
            paymentNumber,
            concept: m.name,
            expectedAmount: m.amount,
            paidAmount: 0,
            balance: m.amount,
            currency: 'USD',
            contractExchangeRate: contract.exchangeRate || null,
            dueDate: m.commitmentDate ? new Date(m.commitmentDate) : null,
            paidDate: null,
            status: 'pendiente',
            paymentMethod: null,
            reference: null,
            notes: null,
            // Campos específicos de hito
            isMilestone: true,
            milestoneName: m.name,
            milestoneOrder: m.order,
            milestoneStatus: 'pendiente',
            milestoneCompletedAt: null,
            milestoneCompletedBy: null,
            milestoneNotes: null,
            commitmentDate: m.commitmentDate ? new Date(m.commitmentDate) : null,
            movements: [],
            createdAt: now,
            updatedAt: now
          })
          paymentNumber++
        }
      }

      if (payments.length === 0) {
        return { count: 0, message: 'No hay pagos para generar' }
      }

      const result = await db.collection(this.collection).insertMany(payments)
      return { count: result.insertedCount, payments }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al generar calendario de pagos', error)
    }
  }

  async regenerateSchedulePreservingPaid(contractId) {
    try {
      if (!ObjectId.isValid(contractId)) throw Boom.badRequest('ID de contrato no válido')

      // 1. Identificar pagos cobrados (parciales o totales) que se preservan
      const existingPayments = await db.collection(this.collection)
        .find({ contractId: contractId.toString() })
        .toArray()

      const paidPayments = existingPayments.filter(p => (p.paidAmount || 0) > 0)
      const unpaidIds = existingPayments
        .filter(p => (p.paidAmount || 0) === 0)
        .map(p => p._id)

      // 2. Borrar solo los no cobrados
      if (unpaidIds.length > 0) {
        await db.collection(this.collection).deleteMany({ _id: { $in: unpaidIds } })
      }

      // 3. Generar el nuevo calendario solo si NO había pagos cobrados aún
      //    (si ya hay cobros, NO sobrescribimos nada — el calendario queda como está
      //     menos los no cobrados que ya borramos. El usuario verá inconsistencia visual
      //     deliberada para forzar revisión manual.)
      if (paidPayments.length === 0) {
        const result = await this.generateSchedule(contractId)
        return {
          preserved: 0,
          removed: unpaidIds.length,
          generated: result.count || 0,
          fullRegeneration: true
        }
      }

      // Si hay pagos cobrados, dejamos solo esos en la BD.
      // El usuario debe completar el resto manualmente si lo necesita.
      return {
        preserved: paidPayments.length,
        removed: unpaidIds.length,
        generated: 0,
        fullRegeneration: false,
        warning: 'Se conservaron pagos con movimientos. No se regeneró el calendario completo para evitar perder histórico.'
      }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al regenerar calendario', error)
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
        if ((p.status === 'pendiente' || p.status === 'parcial') && new Date(p.dueDate) < now) {
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

  // Edición directa de un pago por parte de un administrador (fuera del flujo normal
  // de registro/hitos). Se usa para corregir montos, fechas o datos capturados por error.
  async updatePayment(id, updates, editor) {
    try {
      if (!ObjectId.isValid(id)) throw Boom.badRequest('ID de pago no válido')

      const payment = await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
      if (!payment) throw Boom.notFound('Pago no encontrado')

      const dataToUpdate = {}
      const changes = []

      for (const field of EDITABLE_PAYMENT_FIELDS) {
        if (updates[field] === undefined) continue

        let value = updates[field]
        if (field === 'dueDate' || field === 'paidDate') {
          value = value ? new Date(value) : null
        }
        if (field === 'expectedAmount' || field === 'paidAmount' || field === 'balance') {
          value = Number(value)
          if (Number.isNaN(value)) throw Boom.badData(`El campo ${field} debe ser numérico`)
        }

        const previous = payment[field] ?? null
        const normalizedPrevious = previous instanceof Date ? previous.toISOString() : previous
        const normalizedValue = value instanceof Date ? value.toISOString() : value

        if (normalizedPrevious !== normalizedValue) {
          changes.push({ field, from: normalizedPrevious, to: normalizedValue })
          dataToUpdate[field] = value
        }
      }

      if (changes.length === 0) {
        return { updated: false, message: 'No hay cambios que aplicar', payment }
      }

      dataToUpdate.updatedAt = new Date()

      await db.collection(this.collection).updateOne(
        { _id: new ObjectId(id) },
        { $set: dataToUpdate }
      )

      await this.auditLog.record({
        entity: 'payment',
        entityId: id,
        action: 'payment_updated',
        userId: editor?._id || editor?.id,
        userName: editor?.name || editor?.email,
        changes
      })

      return await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al editar el pago', error)
    }
  }

  async getAuditLog(id) {
    try {
      if (!ObjectId.isValid(id)) throw Boom.badRequest('ID de pago no válido')
      return await this.auditLog.getByEntity('payment', id)
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener el historial del pago', error)
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
        else if (p.status === 'parcial') summary.partialCount++
        else summary.pendingCount++

        // "Vencido" se calcula en vivo por fecha, no por el campo `status` guardado:
        // ese campo solo se refresca de forma perezosa (ver bloque de arriba) y no cubre
        // pagos 'parcial', así que confiar en él subcuenta los vencidos reales.
        if (p.status !== 'pagado' && new Date(p.dueDate) < now) summary.overdueCount++
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

  async getAlerts() {
    try {
      const now = new Date()
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
      const next30 = new Date()
      next30.setDate(next30.getDate() + 30)

      // Pipeline compartido: adjunta datos de contacto del comprador (correo/teléfono)
      // para poder mostrar listas accionables de pagos vencidos/por vencer en el dashboard.
      // contractId (en payments) y buyerId (en contracts) se guardan como string, por eso
      // el match se hace contra $toString('$_id') en lugar de un $lookup directo por _id.
      const buildAlertPipeline = (match) => ([
        { $match: match },
        {
          $lookup: {
            from: 'contracts',
            let: { cid: '$contractId' },
            pipeline: [
              { $match: { $expr: { $eq: [{ $toString: '$_id' }, '$$cid'] } } },
              { $project: { buyerId: 1, contractNumber: 1, projectId: 1 } }
            ],
            as: 'contract'
          }
        },
        { $unwind: { path: '$contract', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'buyers',
            let: { bid: '$contract.buyerId' },
            pipeline: [
              { $match: { $expr: { $eq: [{ $toString: '$_id' }, '$$bid'] } } },
              { $project: { email: 1, phone: 1 } }
            ],
            as: 'buyer'
          }
        },
        { $unwind: { path: '$buyer', preserveNullAndEmptyArrays: true } },
        { $sort: { dueDate: 1 } },
        {
          $project: {
            _id: 1,
            contractId: 1,
            contractNumber: '$contract.contractNumber',
            projectId: '$contract.projectId',
            buyerId: '$contract.buyerId',
            buyerName: 1,
            buyerEmail: '$buyer.email',
            buyerPhone: '$buyer.phone',
            unitIdentifier: 1,
            concept: 1,
            expectedAmount: 1,
            paidAmount: 1,
            balance: 1,
            currency: 1,
            dueDate: 1,
            status: 1
          }
        }
      ])

      const summarize = (items) => ({
        total: items.reduce((sum, p) => sum + (p.balance || 0), 0),
        count: items.length,
        items
      })

      const [overdueItems, dueThisMonthItems, collected, upcomingItems] = await Promise.all([
        // Pagos vencidos
        db.collection(this.collection).aggregate(
          buildAlertPipeline({ status: { $in: ['pendiente', 'parcial', 'vencido'] }, dueDate: { $lt: now } })
        ).toArray(),
        // Vencen este mes
        db.collection(this.collection).aggregate(
          buildAlertPipeline({ status: { $in: ['pendiente', 'parcial'] }, dueDate: { $gte: startOfMonth, $lte: endOfMonth } })
        ).toArray(),
        // Cobrado este mes
        db.collection(this.collection).aggregate([
          { $match: { paidDate: { $gte: startOfMonth, $lte: endOfMonth }, status: 'pagado' } },
          { $group: { _id: null, total: { $sum: '$paidAmount' }, count: { $sum: 1 } } }
        ]).toArray(),
        // Próximos 30 días
        db.collection(this.collection).aggregate(
          buildAlertPipeline({ status: { $in: ['pendiente', 'parcial'] }, dueDate: { $gte: now, $lte: next30 } })
        ).toArray(),
      ])

      // Hitos pagados pendientes de marcar como completados
      const milestonesPendingCompletion = await db.collection('payments').aggregate([
        {
          $match: {
            isMilestone: true,
            milestoneStatus: 'pendiente',
            paidAmount: { $gt: 0 }
          }
        },
        {
          $lookup: {
            from: 'contracts',
            localField: 'contractId',
            foreignField: '_id',
            as: 'contract'
          }
        },
        { $unwind: '$contract' },
        {
          $project: {
            _id: 1,
            concept: 1,
            milestoneName: 1,
            paidAmount: 1,
            expectedAmount: 1,
            buyerName: '$contract.buyerName',
            unitIdentifier: '$contract.unitIdentifier',
            contractNumber: '$contract.contractNumber'
          }
        }
      ]).toArray()

      // Semáforo de hitos (solo los pendientes/sin completar)
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const in15Days = new Date(today)
      in15Days.setDate(in15Days.getDate() + 15)

      const milestonesTraffic = await db.collection(this.collection).aggregate([
        {
          $match: {
            isMilestone: true,
            milestoneStatus: 'pendiente',
            commitmentDate: { $ne: null }
          }
        },
        {
          $lookup: {
            from: 'contracts',
            localField: 'contractId',
            foreignField: '_id',
            as: 'contract'
          }
        },
        { $unwind: { path: '$contract', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 1,
            concept: 1,
            milestoneName: 1,
            expectedAmount: 1,
            paidAmount: 1,
            commitmentDate: 1,
            contractNumber: '$contract.contractNumber',
            buyerName: '$contract.buyerName',
            unitIdentifier: '$contract.unitIdentifier',
            projectId: '$contract.projectId',
            light: {
              $switch: {
                branches: [
                  { case: { $lt: ['$commitmentDate', today] }, then: 'red' },
                  { case: { $lte: ['$commitmentDate', in15Days] }, then: 'yellow' }
                ],
                default: 'green'
              }
            }
          }
        }
      ]).toArray()

      const trafficCounts = {
        red: milestonesTraffic.filter(m => m.light === 'red').length,
        yellow: milestonesTraffic.filter(m => m.light === 'yellow').length,
        green: milestonesTraffic.filter(m => m.light === 'green').length
      }

      return {
        overdue: summarize(overdueItems),
        dueThisMonth: summarize(dueThisMonthItems),
        collected: { total: collected[0]?.total || 0, count: collected[0]?.count || 0 },
        upcoming: summarize(upcomingItems),
        milestonesPendingCompletion: {
          count: milestonesPendingCompletion.length,
          total: milestonesPendingCompletion.reduce((s, m) => s + (m.paidAmount || 0), 0),
          items: milestonesPendingCompletion
        },milestonesTraffic: {
          counts: trafficCounts,
          items: milestonesTraffic
        }
      }
    } catch (error) {
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

      // Una fecha "YYYY-MM-DD" se parsea como medianoche UTC (inicio del día), no su fin.
      // Usada tal cual como límite superior, excluye la actividad del propio día final
      // (p. ej. "hasta hoy" daba 0 para lo registrado hoy). Extendemos al final del día en UTC.
      const queryEnd = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 23, 59, 59, 999))

      // Aggregation: desplegamos todos los movements y filtramos por rango de fecha.
      // Se usa la fecha del TC (exchangeRateDate) como fecha de pago real, no
      // registeredAt (que es solo cuándo se capturó el movimiento en el sistema).
      const [result, soldResult] = await Promise.all([
        db.collection(this.collection).aggregate([
          { $match: { movements: { $exists: true, $ne: [] } } },
          { $unwind: '$movements' },
          {
            $match: {
              'movements.exchangeRateDate': { $gte: start, $lte: queryEnd }
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
        ]).toArray(),
        // Vendido: contratos no cancelados creados dentro del mismo rango
        db.collection('contracts').aggregate([
          { $match: { status: { $ne: 'cancelado' }, createdAt: { $gte: start, $lte: queryEnd } } },
          { $group: { _id: null, totalSoldUSD: { $sum: '$salePrice' } } }
        ]).toArray()
      ])

      const summary = result[0] || {
        totalUSD: 0,
        totalMXN: 0,
        movementsCount: 0,
        paymentsCount: 0,
        contractsCount: 0
      }
      summary.totalSoldUSD = soldResult[0]?.totalSoldUSD || 0

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

  async addVouchers(id, files, uploader) {
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
      uploadedAt: new Date(),
      uploadedBy: uploader?.name || uploader?.email || null
    }))

    await db.collection(this.collection).updateOne(
      { _id: new ObjectId(id) },
      {
        $push: { vouchers: { $each: vouchers } },
        $set: { updatedAt: new Date() }
      }
    )

    await this.auditLog.record({
      entity: 'payment',
      entityId: id,
      action: 'voucher_added',
      userId: uploader?._id || uploader?.id,
      userName: uploader?.name || uploader?.email,
      meta: { files: vouchers.map(v => v.originalName) }
    })

    return { added: vouchers.length, vouchers }
  } catch (error) {
    if (Boom.isBoom(error)) throw error
    throw Boom.badImplementation('Error al agregar comprobantes', error)
  }
}

async removeVoucher(id, fileName, remover) {
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

    await this.auditLog.record({
      entity: 'payment',
      entityId: id,
      action: 'voucher_removed',
      userId: remover?._id || remover?.id,
      userName: remover?.name || remover?.email,
      meta: { fileName }
    })

    return { removed: fileName }
  } catch (error) {
    if (Boom.isBoom(error)) throw error
    throw Boom.badImplementation('Error al eliminar comprobante', error)
  }
}

// Marcar hito como completado (Línea 2)
  async completeMilestone(paymentId, { commitmentDate, notes, completedBy } = {}) {
    try {
      if (!ObjectId.isValid(paymentId)) throw Boom.badRequest('ID de pago no válido')

      const payment = await db.collection(this.collection).findOne({ _id: new ObjectId(paymentId) })
      if (!payment) throw Boom.notFound('Pago no encontrado')
      if (!payment.isMilestone) throw Boom.badRequest('Este pago no es un hito de obra')
      if (payment.milestoneStatus === 'completado') throw Boom.badRequest('El hito ya está marcado como completado')

      // Nueva validación: requiere al menos un pago registrado
      if (!payment.paidAmount || payment.paidAmount <= 0) {
        throw Boom.forbidden('No se puede completar el hito: aún no tiene pagos registrados')
      }

      if (!commitmentDate) {
        throw Boom.badRequest('La fecha compromiso de entrega es requerida')
      }

      const update = {
        milestoneStatus: 'completado',
        milestoneCompletedAt: new Date(),
        commitmentDate: new Date(commitmentDate),
        milestoneNotes: notes || null,
        milestoneCompletedBy: completedBy || null,
        updatedAt: new Date()
      }

      await db.collection(this.collection).updateOne(
        { _id: new ObjectId(paymentId) },
        { $set: update }
      )

      return await db.collection(this.collection).findOne({ _id: new ObjectId(paymentId) })
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al completar el hito', error)
    }
  }

  async updateMilestoneCommitment(paymentId, { commitmentDate, notes }) {
    try {
      if (!ObjectId.isValid(paymentId)) throw Boom.badRequest('ID de pago no válido')

      const payment = await db.collection(this.collection).findOne({ _id: new ObjectId(paymentId) })
      if (!payment) throw Boom.notFound('Pago no encontrado')
      if (!payment.isMilestone) throw Boom.badRequest('Este pago no es un hito de obra')
      if (payment.milestoneStatus !== 'completado') {
        throw Boom.badRequest('Solo se puede editar la fecha compromiso de hitos completados')
      }
      if (!commitmentDate) throw Boom.badRequest('La fecha compromiso es requerida')

      const set = {
        commitmentDate: new Date(commitmentDate),
        updatedAt: new Date()
      }
      if (notes !== undefined) set.milestoneNotes = notes

      await db.collection(this.collection).updateOne(
        { _id: new ObjectId(paymentId) },
        { $set: set }
      )

      return await db.collection(this.collection).findOne({ _id: new ObjectId(paymentId) })
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al actualizar la fecha compromiso', error)
    }
  }

  // Revertir hito (en caso de error de captura) - solo si no hay movimientos
  async uncompleteMilestone(paymentId) {
    try {
      if (!ObjectId.isValid(paymentId)) throw Boom.badRequest('ID de pago no válido')

      const payment = await db.collection(this.collection).findOne({ _id: new ObjectId(paymentId) })
      if (!payment) throw Boom.notFound('Pago no encontrado')
      if (!payment.isMilestone) throw Boom.badRequest('Este pago no es un hito de obra')
      if (payment.milestoneStatus !== 'completado') {
        throw Boom.badRequest('El hito no está completado')
      }

      await db.collection(this.collection).updateOne(
        { _id: new ObjectId(paymentId) },
        {
          $set: {
            milestoneStatus: 'pendiente',
            updatedAt: new Date()
          },
          $unset: {
            milestoneCompletedAt: '',
            commitmentDate: '',
            milestoneCompletedBy: ''
            // milestoneNotes se conserva como histórico
          }
        }
      )

      return await db.collection(this.collection).findOne({ _id: new ObjectId(paymentId) })
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al revertir el hito', error)
    }
  }

  async getOpenContractsByProject(projectId, sellerId = null) {
    try {
      if (!ObjectId.isValid(projectId)) throw Boom.badRequest('ID de proyecto no válido')

      const matchStage = {
        projectId: projectId.toString(),
        status: { $nin: ['cancelado'] } // Excluir solo cancelados; saldo > 0 lo decide el siguiente paso
      }
      if (sellerId) matchStage.sellerId = sellerId

      // 1. Buscar contratos del proyecto que tengan pagos con saldo > 0
      const contracts = await db.collection('contracts').aggregate([
        {
          $match: matchStage
        },
        {
          $lookup: {
            from: 'payments',
            let: { contractIdStr: { $toString: '$_id' } },
            pipeline: [
              { $match: { $expr: { $eq: ['$contractId', '$$contractIdStr'] } } },
              { $sort: { paymentNumber: 1 } }
            ],
            as: 'payments'
          }
        },
        {
          // Calcular agregados
          $addFields: {
            totalExpected: { $sum: '$payments.expectedAmount' },
            totalPaid: { $sum: '$payments.paidAmount' },
            totalBalance: { $sum: '$payments.balance' },
            paymentsCount: { $size: '$payments' },
            paidCount: {
              $size: { $filter: { input: '$payments', cond: { $eq: ['$$this.status', 'pagado'] } } }
            },
            // Igual que en getContractSummary: se calcula en vivo por fecha, no por el
            // campo `status` guardado (ese solo se refresca al abrir el contrato y no cubre 'parcial').
            overdueCount: {
              $size: {
                $filter: {
                  input: '$payments',
                  cond: { $and: [{ $ne: ['$$this.status', 'pagado'] }, { $lt: ['$$this.dueDate', '$$NOW'] }] }
                }
              }
            }
          }
        },
        {
          // Solo contratos con saldo > 0 (= "abiertos" según definición del cliente)
          $match: { totalBalance: { $gt: 0 } }
        },
        { $sort: { createdAt: -1 } }
      ]).toArray()

      return contracts
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener contratos del proyecto', error)
    }
  }
}

export default Payments