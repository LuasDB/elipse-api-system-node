import { db } from './../db/mongoClient.js'
import Boom from '@hapi/boom'
import ExcelJS from 'exceljs'

const GROUP_BY_VALUES = ['month', 'week', 'day']

const MODALITY_LABELS = {
  monthly: 'MENSUALIDADES',
  milestones: 'HITOS DE OBRA'
}

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
          // Excluye pagos de contratos cancelados: no cuentan como cobrado.
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
          { $match: { 'contract.status': { $ne: 'cancelado' } } },
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

  // Excel con todos los contratos (formato "TABLA EJEMPLO"): Proyecto, Inmueble,
  // Comprador, Importe, Condiciones de pago, Periodo de pagos (Inicio/Fin),
  // Pagos vencidos y Adeudo. Pagos vencidos/adeudo se calculan en vivo a partir
  // del calendario de pagos de cada contrato, igual que en el resumen de un contrato.
  async exportContractsExcel() {
    try {
      const now = new Date()

      const contracts = await db.collection('contracts').aggregate([
        {
          $lookup: {
            from: 'payments',
            let: { contractIdStr: { $toString: '$_id' } },
            pipeline: [
              { $match: { $expr: { $eq: ['$contractId', '$$contractIdStr'] } } },
              { $project: { balance: 1, status: 1, dueDate: 1 } }
            ],
            as: 'payments'
          }
        },
        {
          $lookup: {
            from: 'projects',
            let: { pid: '$projectId' },
            pipeline: [
              { $match: { $expr: { $eq: [{ $toString: '$_id' }, '$$pid'] } } },
              { $project: { name: 1 } }
            ],
            as: 'project'
          }
        },
        { $unwind: { path: '$project', preserveNullAndEmptyArrays: true } },
        {
          $addFields: {
            totalBalance: { $sum: '$payments.balance' },
            overdueCount: {
              $size: {
                $filter: {
                  input: '$payments',
                  cond: { $and: [{ $ne: ['$$this.status', 'pagado'] }, { $lt: ['$$this.dueDate', now] }] }
                }
              }
            },
            periodStart: { $min: '$payments.dueDate' },
            periodEnd: { $max: '$payments.dueDate' }
          }
        },
        {
          $project: {
            projectName: '$project.name',
            unitIdentifier: 1,
            buyerName: 1,
            salePrice: 1,
            modality: 1,
            totalBalance: 1,
            overdueCount: 1,
            periodStart: 1,
            periodEnd: 1
          }
        },
        { $sort: { projectName: 1, unitIdentifier: 1 } }
      ]).toArray()

      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet('Contratos')

      sheet.columns = [
        { key: 'projectName', width: 22 },
        { key: 'unitIdentifier', width: 20 },
        { key: 'buyerName', width: 34 },
        { key: 'salePrice', width: 14 },
        { key: 'modality', width: 22 },
        { key: 'periodStart', width: 14 },
        { key: 'periodEnd', width: 14 },
        { key: 'overdueCount', width: 15 },
        { key: 'totalBalance', width: 16 }
      ]

      sheet.mergeCells('A1:A2')
      sheet.mergeCells('B1:B2')
      sheet.mergeCells('C1:C2')
      sheet.mergeCells('D1:D2')
      sheet.mergeCells('E1:E2')
      sheet.mergeCells('F1:G1')
      sheet.mergeCells('H1:H2')
      sheet.mergeCells('I1:I2')

      sheet.getCell('A1').value = 'PROYECTO'
      sheet.getCell('B1').value = 'INMUEBLE'
      sheet.getCell('C1').value = 'COMPRADOR'
      sheet.getCell('D1').value = 'IMPORTE'
      sheet.getCell('E1').value = 'CONDICIONES DE PAGO'
      sheet.getCell('F1').value = 'PERIODO DE PAGOS'
      sheet.getCell('H1').value = 'PAGOS VENCIDOS'
      sheet.getCell('I1').value = 'ADEUDO'
      sheet.getCell('F2').value = 'INICIO'
      sheet.getCell('G2').value = 'FIN'

      ;[1, 2].forEach(rowNum => {
        sheet.getRow(rowNum).eachCell({ includeEmpty: true }, cell => {
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A5C' } }
          cell.border = {
            top: { style: 'thin' }, left: { style: 'thin' },
            bottom: { style: 'thin' }, right: { style: 'thin' }
          }
        })
      })
      sheet.getRow(1).height = 20
      sheet.getRow(2).height = 18

      contracts.forEach(c => {
        const row = sheet.addRow({
          projectName: c.projectName || '',
          unitIdentifier: c.unitIdentifier || '',
          buyerName: c.buyerName || '',
          salePrice: c.salePrice || 0,
          modality: MODALITY_LABELS[c.modality] || c.modality || '',
          periodStart: c.periodStart || null,
          periodEnd: c.periodEnd || null,
          overdueCount: c.overdueCount || 0,
          totalBalance: c.totalBalance || 0
        })
        row.getCell('salePrice').numFmt = '$#,##0.00'
        row.getCell('totalBalance').numFmt = '$#,##0.00'
        row.getCell('periodStart').numFmt = 'dd/mm/yyyy'
        row.getCell('periodEnd').numFmt = 'dd/mm/yyyy'
        row.eachCell({ includeEmpty: true }, cell => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE4E8EE' } },
            left: { style: 'thin', color: { argb: 'FFE4E8EE' } },
            bottom: { style: 'thin', color: { argb: 'FFE4E8EE' } },
            right: { style: 'thin', color: { argb: 'FFE4E8EE' } }
          }
        })
      })

      sheet.views = [{ state: 'frozen', ySplit: 2 }]

      return workbook
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al generar el reporte de contratos', error)
    }
  }
}

export default Reports
