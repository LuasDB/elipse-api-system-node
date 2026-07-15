import { db } from './../db/mongoClient.js'
import Boom from '@hapi/boom'

const GROUP_BY_VALUES = ['month', 'week', 'day']

class Reports {
  // Vendido (contratos creados en el rango) vs cobrado (movimientos de pago cuya fecha de TC
  // cae en el rango — esa es la fecha de pago real, no cuándo se capturó en el sistema),
  // agrupado por día, semana (bloques de 7 días desde startDate) o mes.
  async getSalesVsCollections(startDate, endDate, groupBy = 'month') {
    try {
      if (!startDate || !endDate) throw Boom.badData('Las fechas de inicio y fin son requeridas')

      const start = new Date(startDate)
      const end = new Date(endDate)
      if (isNaN(start.getTime()) || isNaN(end.getTime())) throw Boom.badData('Las fechas no son válidas')
      if (start > end) throw Boom.badData('La fecha de inicio no puede ser posterior a la fecha de fin')

      const group = GROUP_BY_VALUES.includes(groupBy) ? groupBy : 'month'

      // Una fecha "YYYY-MM-DD" se parsea como medianoche UTC de ese día (00:00:00),
      // es decir el INICIO del día final, no su fin. Usada tal cual como límite superior,
      // excluye cualquier actividad registrada ese mismo día (p. ej. "hasta hoy" siempre
      // daba 0 para lo del día en curso). Extendemos el límite al final de ese día en UTC.
      const queryEnd = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 23, 59, 59, 999))

      const [soldDaily, collectedDaily] = await Promise.all([
        db.collection('contracts').aggregate([
          { $match: { status: { $ne: 'cancelado' }, createdAt: { $gte: start, $lte: queryEnd } } },
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, total: { $sum: '$salePrice' } } }
        ]).toArray(),
        db.collection('payments').aggregate([
          { $match: { movements: { $exists: true, $ne: [] } } },
          { $unwind: '$movements' },
          { $match: { 'movements.exchangeRateDate': { $gte: start, $lte: queryEnd } } },
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$movements.exchangeRateDate' } }, total: { $sum: '$movements.amount' } } }
        ]).toArray()
      ])

      const soldMap = Object.fromEntries(soldDaily.map(r => [r._id, r.total]))
      const collectedMap = Object.fromEntries(collectedDaily.map(r => [r._id, r.total]))

      // Todo el recorrido de días se hace en UTC para alinear con el UTC
      // por defecto de $dateToString en Mongo (evita desfases por zona horaria del server).
      const buckets = new Map()
      const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))
      const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()))
      let dayIndex = 0

      while (cursor <= lastDay) {
        const dayKey = cursor.toISOString().slice(0, 10)
        const bucketKey = group === 'month'
          ? dayKey.slice(0, 7)
          : group === 'week'
            ? `Sem ${Math.floor(dayIndex / 7) + 1}`
            : dayKey

        if (!buckets.has(bucketKey)) {
          buckets.set(bucketKey, { period: bucketKey, sold: 0, collected: 0 })
        }
        const bucket = buckets.get(bucketKey)
        bucket.sold += soldMap[dayKey] || 0
        bucket.collected += collectedMap[dayKey] || 0

        cursor.setUTCDate(cursor.getUTCDate() + 1)
        dayIndex++
      }

      return Array.from(buckets.values())
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener el reporte de ventas y cobranza', error)
    }
  }
}

export default Reports
