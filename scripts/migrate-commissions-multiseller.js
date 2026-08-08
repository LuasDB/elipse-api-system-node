// Migración no destructiva: agrega amount/description/sellerName a los docs
// existentes de `commissions` (creados con el esquema viejo de %), y mueve
// los comprobantes ya subidos a la nueva ruta anidada por vendedor.
// Uso (desde elipse-api-system-node/): MONGO_DATABASE=<db> node scripts/migrate-commissions-multiseller.js
// No borra percentage/baseAmount/commissionAmount ni ningún archivo: solo agrega campos y reubica vouchers.

import { db, client } from './../db/mongoClient.js'
import fs from 'fs'
import path from 'path'
import { ObjectId } from 'mongodb'

const sellerObjectId = (id) => {
  try { return new ObjectId(id) } catch { return null }
}

const run = async () => {
  const commissions = await db.collection('commissions').find({ amount: { $exists: false } }).toArray()
  console.log(`Encontrados ${commissions.length} documentos de comisión con esquema viejo`)

  let migratedDocs = 0
  let movedFiles = 0
  let missingFiles = 0

  for (const c of commissions) {
    const lastHistory = (c.history || [])[c.history.length - 1]
    const rawNotes = lastHistory?.notes
    const description = (rawNotes && rawNotes.trim())
      ? rawNotes.trim()
      : `Comisión migrada (antes ${c.percentage}% de $${Number(c.baseAmount).toLocaleString('en-US')})`

    let sellerName = null
    if (c.sellerId) {
      const seller = await db.collection('users').findOne({ _id: sellerObjectId(c.sellerId) })
      sellerName = seller?.name || null
    }

    await db.collection('commissions').updateOne(
      { _id: c._id },
      {
        $set: {
          amount: c.commissionAmount,
          description,
          sellerName,
          updatedAt: new Date()
        }
      }
    )
    migratedDocs++

    // Mover comprobantes de uploads/commissions/{contractId}/{file} -> uploads/commissions/{contractId}/{sellerId}/{file}
    const oldDir = path.join('uploads', 'commissions', c.contractId)
    const newDir = path.join('uploads', 'commissions', c.contractId, c.sellerId)

    for (const movement of c.movements || []) {
      for (const voucher of movement.vouchers || []) {
        const oldPath = path.join(oldDir, voucher.fileName)
        const newPath = path.join(newDir, voucher.fileName)
        if (fs.existsSync(oldPath)) {
          fs.mkdirSync(newDir, { recursive: true })
          fs.renameSync(oldPath, newPath)
          movedFiles++
        } else if (!fs.existsSync(newPath)) {
          console.warn(`  ! No se encontró el archivo físico: ${oldPath}`)
          missingFiles++
        }
      }
    }
  }

  console.log(`Migrados ${migratedDocs} documentos. Archivos movidos: ${movedFiles}. Archivos faltantes: ${missingFiles}.`)
  await client.close()
}

run().catch(err => { console.error(err); process.exit(1) })
