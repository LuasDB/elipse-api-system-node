import { ObjectId } from 'mongodb'
import { db } from './../db/mongoClient.js'
import Boom from '@hapi/boom'
import Commissions from './commissions.service.js'

class Sellers {
  constructor() {
    this.commissions = new Commissions()
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

      const contracts = await db.collection('contracts')
        .find({ sellerId: id })
        .sort({ createdAt: -1 })
        .toArray()

      const contractsWithCommission = await Promise.all(
        contracts.map(async (contract) => {
          const commission = await this.commissions.getByContract(contract._id.toString())
          return { ...contract, commission }
        })
      )

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
