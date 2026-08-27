import { ObjectId } from 'mongodb'
import { db } from './../db/mongoClient.js'
import Boom from '@hapi/boom'
import Commissions from './commissions.service.js'
import Attachments from './attachments.service.js'
import AuditLog from './auditLog.service.js'

const RELATED_TO = 'sellers'

class Sellers {
  constructor() {
    this.commissions = new Commissions()
    this.attachments = new Attachments()
    this.auditLog = new AuditLog()
  }

  async _assertExists(sellerId) {
    if (!ObjectId.isValid(sellerId)) throw Boom.badRequest('El ID del vendedor no es válido')
    const seller = await db.collection('users').findOne({ _id: new ObjectId(sellerId), role: 'vendedor' })
    if (!seller) throw Boom.notFound('Vendedor no encontrado')
    return seller
  }

  async getAttachments(sellerId) {
    await this._assertExists(sellerId)
    return this.attachments.getByRelatedId(RELATED_TO, sellerId)
  }

  async addAttachments(sellerId, files, context) {
    const seller = await this._assertExists(sellerId)

    const uploadedBy = context?.actor?.userId
    const results = []
    for (const file of files) {
      const attachment = await this.attachments.create({
        file,
        uploadedBy,
        relatedTo: RELATED_TO,
        relatedId: sellerId
      })
      results.push(attachment)
    }

    await this.auditLog.record({
      entity: 'seller',
      entityId: sellerId,
      entityLabel: seller.name,
      action: 'attachment_added',
      actor: context?.actor,
      meta: { ip: context?.ip || null, files: results.map(r => r.filename) }
    })

    return results
  }

  async deleteAttachment(sellerId, attachmentId, context) {
    const seller = await this._assertExists(sellerId)
    const attachment = await this.attachments.getById(attachmentId)
    if (String(attachment.relatedId) !== String(sellerId) || attachment.relatedTo !== RELATED_TO) {
      throw Boom.notFound('El adjunto no pertenece a este vendedor')
    }

    const result = await this.attachments.deleteById(attachmentId)

    await this.auditLog.record({
      entity: 'seller',
      entityId: sellerId,
      entityLabel: seller.name,
      action: 'attachment_deleted',
      actor: context?.actor,
      meta: { ip: context?.ip || null, filename: attachment.filename }
    })

    return result
  }

  async getAuditLog(sellerId) {
    await this._assertExists(sellerId)
    const { items } = await this.auditLog.getByEntity('seller', sellerId, { limit: 200 })
    return items
  }

  async _getContractStats(sellerId) {
    const result = await db.collection('contracts').aggregate([
      { $match: { sellerId } },
      {
        $group: {
          _id: null,
          contractsCount: { $sum: 1 },
          totalSales: { $sum: '$salePrice' }
        }
      }
    ]).toArray()

    return result[0] || { contractsCount: 0, totalSales: 0 }
  }

  async getAll() {
    try {
      const sellers = await db.collection('users').find(
        { role: 'vendedor' },
        { projection: { password: 0 } }
      ).sort({ name: 1 }).toArray()

      const enriched = await Promise.all(
        sellers.map(async (seller) => {
          const sellerId = seller._id.toString()
          const [contractStats, commissionSummary] = await Promise.all([
            this._getContractStats(sellerId),
            this.commissions.getSellerSummary(sellerId)
          ])

          return {
            ...seller,
            stats: {
              contractsCount: contractStats.contractsCount,
              totalSales: contractStats.totalSales,
              commissionAssigned: commissionSummary.totalAssigned,
              commissionPaid: commissionSummary.totalPaid,
              commissionPending: commissionSummary.totalPending
            }
          }
        })
      )

      return enriched
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener los vendedores', error)
    }
  }

  async getProfile(id) {
    try {
      if (!ObjectId.isValid(id)) throw Boom.badRequest('El ID del vendedor no es válido')

      const seller = await db.collection('users').findOne(
        { _id: new ObjectId(id) },
        { projection: { password: 0 } }
      )
      if (!seller) throw Boom.notFound(`No se encontró el vendedor con ID ${id}`)

      // Contratos donde es el vendedor principal + contratos donde solo tiene una
      // comisión asignada (vendedor secundario agregado vía el panel de comisiones)
      const primaryContracts = await db.collection('contracts')
        .find({ sellerId: id })
        .sort({ createdAt: -1 })
        .toArray()

      const ownCommissions = await this.commissions.getBySeller(id)
      const primaryIds = new Set(primaryContracts.map(c => c._id.toString()))
      const secondaryContractIds = [...new Set(ownCommissions.map(c => c.contractId))]
        .filter(cid => !primaryIds.has(cid) && ObjectId.isValid(cid))

      const secondaryContracts = secondaryContractIds.length
        ? await db.collection('contracts')
          .find({ _id: { $in: secondaryContractIds.map(cid => new ObjectId(cid)) } })
          .sort({ createdAt: -1 })
          .toArray()
        : []

      const contracts = [...primaryContracts, ...secondaryContracts]

      const contractsWithCommission = contracts.map((contract) => {
        const commission = ownCommissions.find(c => c.contractId === contract._id.toString()) || null
        return { ...contract, commission }
      })

      const [contractStats, commissionSummary] = await Promise.all([
        this._getContractStats(id),
        this.commissions.getSellerSummary(id)
      ])

      return {
        ...seller,
        contracts: contractsWithCommission,
        stats: {
          contractsCount: contractStats.contractsCount,
          totalSales: contractStats.totalSales,
          commissionAssigned: commissionSummary.totalAssigned,
          commissionPaid: commissionSummary.totalPaid,
          commissionPending: commissionSummary.totalPending
        }
      }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener el perfil del vendedor', error)
    }
  }
}

export default Sellers
