import { ObjectId } from 'mongodb'
import { db } from './../db/mongoClient.js'
import Boom from '@hapi/boom'

class Buyers {
  constructor() {
    this.collection = 'buyers'
  }

  async create(data) {
    try {
      const { name, email } = data
      if (!name || !name.trim()) throw Boom.badData('El nombre del comprador es requerido')

      if (email) {
        const existing = await db.collection(this.collection).findOne({ email })
        if (existing) throw Boom.conflict(`Ya existe un comprador con el correo ${email}`)
      }

      const buyer = {
        ...data,
        createdAt: new Date(),
        updatedAt: new Date()
      }

      const result = await db.collection(this.collection).insertOne(buyer)
      return { _id: result.insertedId, ...buyer }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al crear el comprador', error)
    }
  }

  async getAll(filters = {}) {
    try {
      const query = {}
      if (filters.search) {
        query.$or = [
          { name: { $regex: filters.search, $options: 'i' } },
          { email: { $regex: filters.search, $options: 'i' } },
          { phone: { $regex: filters.search, $options: 'i' } },
          { rfc: { $regex: filters.search, $options: 'i' } }
        ]
      }

      const buyers = await db.collection(this.collection)
        .find(query)
        .sort({ name: 1 })
        .toArray()

      return buyers
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener compradores', error)
    }
  }

  async getOneById(id) {
    try {
      if (!ObjectId.isValid(id)) throw Boom.badRequest('El ID del comprador no es válido')
      const buyer = await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
      if (!buyer) throw Boom.notFound(`No se encontró el comprador con ID ${id}`)
      return buyer
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener el comprador', error)
    }
  }

  async updateOneById(id, newData) {
    try {
      if (!ObjectId.isValid(id)) throw Boom.badRequest('El ID del comprador no es válido')
      const { _id, ...dataToUpdate } = newData
      dataToUpdate.updatedAt = new Date()

      const result = await db.collection(this.collection).updateOne(
        { _id: new ObjectId(id) },
        { $set: dataToUpdate }
      )
      if (result.matchedCount === 0) throw Boom.notFound(`No se encontró el comprador con ID ${id}`)
      return result
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al actualizar el comprador', error)
    }
  }

  async deleteOneById(id) {
    try {
      if (!ObjectId.isValid(id)) throw Boom.badRequest('El ID del comprador no es válido')

      // Verificar si tiene contratos
      const contractsCount = await db.collection('contracts').countDocuments({ buyerId: id })
      if (contractsCount > 0) {
        throw Boom.conflict(`No se puede eliminar porque tiene ${contractsCount} contrato(s) asociado(s)`)
      }

      const result = await db.collection(this.collection).deleteOne({ _id: new ObjectId(id) })
      if (result.deletedCount === 0) throw Boom.notFound(`No se encontró el comprador con ID ${id}`)
      return result
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al eliminar el comprador', error)
    }
  }
}

export default Buyers
