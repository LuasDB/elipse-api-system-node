import { ObjectId } from 'mongodb'
import { db } from './../db/mongoClient.js'
import Boom from '@hapi/boom'

class Contracts {
  constructor() {
    this.collection = 'contracts'
  }

  // Valida y normaliza milestones de Línea 2
  validateAndNormalizeMilestones(milestones) {
    if (!Array.isArray(milestones) || milestones.length === 0) {
      throw Boom.badData('Debe definir al menos un hito de obra')
    }

    const normalized = milestones.map((m, idx) => {
      if (!m.name || !m.name.trim()) {
        throw Boom.badData(`El hito #${idx + 1} requiere un nombre`)
      }
      const amount = Number(m.amount)
      if (!amount || amount <= 0) {
        throw Boom.badData(`El hito "${m.name}" requiere un monto mayor a 0`)
      }
      return {
        name: m.name.trim(),
        amount,
        estimatedDate: m.estimatedDate ? new Date(m.estimatedDate) : null,
        order: Number(m.order) || (idx + 1)
      }
    }).sort((a, b) => a.order - b.order)
       .map((m, idx) => ({ ...m, order: idx + 1 }))

    return normalized
  }

  // Mapea el estado del contrato al estado correspondiente de la unidad
  getUnitStatusFromContract(contractStatus) {
    const map = {
      promesa: 'apartada',
      definitivo: 'en_escrituracion',
      escriturado: 'vendida',
      entregado: 'entregada',
      cancelado: 'disponible'
    }
    return map[contractStatus] || null
  }

  async create(data) {
    try {
      const { projectId, unitId, buyerId, sellerId, modality } = data

      if (!ObjectId.isValid(projectId)) throw Boom.badData('Proyecto no válido')
      if (!ObjectId.isValid(unitId)) throw Boom.badData('Unidad no válida')
      if (!ObjectId.isValid(buyerId)) throw Boom.badData('Comprador no válido')

      // Validar relaciones
      const buyer = await db.collection('buyers').findOne({ _id: new ObjectId(buyerId) })
      if (!buyer) throw Boom.notFound('Comprador no encontrado')

      const unit = await db.collection('units').findOne({ _id: new ObjectId(unitId) })
      if (!unit) throw Boom.notFound('Unidad no encontrada')

      // Validar tipo de cambio
      const exchangeRate = Number(data.exchangeRate)
      if (!exchangeRate || exchangeRate <= 0) {
        throw Boom.badData('El tipo de cambio (USD a MXN) es requerido y debe ser mayor a 0')
      }

      // Validar modalidad
      const contractModality = modality || 'monthly'
      if (!['monthly', 'milestones'].includes(contractModality)) {
        throw Boom.badData('Modalidad no válida (debe ser monthly o milestones)')
      }

      // Si es modalidad por hitos, validar y normalizar
      let milestonesTemplate = []
      if (contractModality === 'milestones') {
        milestonesTemplate = this.validateAndNormalizeMilestones(data.milestonesTemplate || [])
      }

      const contract = {
        ...data,
        contractNumber: data.contractNumber || await this.generateContractNumber(projectId),
        // Modalidad
        modality: contractModality,
        milestonesTemplate,
        // Montos en USD (moneda fuente)
        salePrice: Number(data.salePrice) || 0,
        downPayment: Number(data.downPayment) || 0,
        monthlyPayment: Number(data.monthlyPayment) || 0,
        totalPayments: Number(data.totalPayments) || 0,
        currency: 'USD',
        // Tipo de cambio del contrato
        exchangeRate,
        exchangeRateDate: data.exchangeRateDate ? new Date(data.exchangeRateDate) : new Date(),
        status: data.status || 'promesa',
        // Snapshots para referencia rápida
        buyerName: buyer.name,
        unitIdentifier: unit.identifier,
        signatures: data.signatures || [],
        createdAt: new Date(),
        updatedAt: new Date()
      }

      const result = await db.collection(this.collection).insertOne(contract)

      // Actualizar estado de la unidad según contrato
      const unitStatus = this.getUnitStatusFromContract(contract.status)
      if (unitStatus) {
        await db.collection('units').updateOne(
          { _id: new ObjectId(unitId) },
          { $set: { status: unitStatus, updatedAt: new Date() } }
        )
      }

      return { _id: result.insertedId, ...contract }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al crear el contrato', error)
    }
  }

  async generateContractNumber(projectId) {
    const count = await db.collection(this.collection).countDocuments({ projectId })
    const year = new Date().getFullYear()
    return `CONT-${year}-${String(count + 1).padStart(4, '0')}`
  }

  async getAll(filters = {}) {
    try {
      const query = {}
      if (filters.projectId) query.projectId = filters.projectId
      if (filters.status) query.status = filters.status
      if (filters.buyerId) query.buyerId = filters.buyerId
      if (filters.sellerId) query.sellerId = filters.sellerId
      if (filters.search) {
        query.$or = [
          { contractNumber: { $regex: filters.search, $options: 'i' } },
          { buyerName: { $regex: filters.search, $options: 'i' } },
          { unitIdentifier: { $regex: filters.search, $options: 'i' } }
        ]
      }

      const contracts = await db.collection(this.collection)
        .find(query)
        .sort({ createdAt: -1 })
        .toArray()

      // Enriquecer con datos del proyecto
      const enriched = await Promise.all(
        contracts.map(async (contract) => {
          let projectName = ''
          if (contract.projectId && ObjectId.isValid(contract.projectId)) {
            const project = await db.collection('projects').findOne(
              { _id: new ObjectId(contract.projectId) },
              { projection: { name: 1 } }
            )
            projectName = project?.name || ''
          }
          return { ...contract, projectName }
        })
      )

      return enriched
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener contratos', error)
    }
  }

  async getOneById(id) {
    try {
      if (!ObjectId.isValid(id)) throw Boom.badRequest('El ID del contrato no es válido')
      const contract = await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
      if (!contract) throw Boom.notFound(`No se encontró el contrato con ID ${id}`)

      // Enriquecer con datos completos
      let buyer = null, unit = null, project = null, seller = null

      if (contract.buyerId && ObjectId.isValid(contract.buyerId)) {
        buyer = await db.collection('buyers').findOne({ _id: new ObjectId(contract.buyerId) })
      }
      if (contract.unitId && ObjectId.isValid(contract.unitId)) {
        unit = await db.collection('units').findOne({ _id: new ObjectId(contract.unitId) })
      }
      if (contract.projectId && ObjectId.isValid(contract.projectId)) {
        project = await db.collection('projects').findOne({ _id: new ObjectId(contract.projectId) })
      }
      if (contract.sellerId && ObjectId.isValid(contract.sellerId)) {
        seller = await db.collection('users').findOne(
          { _id: new ObjectId(contract.sellerId) },
          { projection: { password: 0 } }
        )
      }

      return { ...contract, buyer, unit, project, seller }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al obtener el contrato', error)
    }
  }

  async updateOneById(id, newData) {
    try {
      if (!ObjectId.isValid(id)) throw Boom.badRequest('ID no válido')

      const existing = await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
      if (!existing) throw Boom.notFound('Contrato no encontrado')

      const { _id, buyer, unit, project, seller, projectName, ...dataToUpdate } = newData
      dataToUpdate.updatedAt = new Date()

      // Convertir numéricos
      const numericFields = ['salePrice', 'downPayment', 'monthlyPayment', 'totalPayments', 'exchangeRate']
      numericFields.forEach(field => {
        if (dataToUpdate[field] !== undefined) dataToUpdate[field] = Number(dataToUpdate[field]) || 0
      })

      // Validar TC si se está actualizando
      if (dataToUpdate.exchangeRate !== undefined && dataToUpdate.exchangeRate <= 0) {
        throw Boom.badData('El tipo de cambio debe ser mayor a 0')
      }

      // Convertir fecha del TC
      if (dataToUpdate.exchangeRateDate) {
        dataToUpdate.exchangeRateDate = new Date(dataToUpdate.exchangeRateDate)
      }

      // Si cambia modalidad o hitos, validar
      if (dataToUpdate.modality && !['monthly', 'milestones'].includes(dataToUpdate.modality)) {
        throw Boom.badData('Modalidad no válida')
      }

      const finalModality = dataToUpdate.modality || existing.modality || 'monthly'
      if (finalModality === 'milestones' && dataToUpdate.milestonesTemplate !== undefined) {
        dataToUpdate.milestonesTemplate = this.validateAndNormalizeMilestones(dataToUpdate.milestonesTemplate)
      }

      // Detectar si es necesario regenerar pagos (cambio de modalidad o de hitos)
      const modalityChanged = dataToUpdate.modality && dataToUpdate.modality !== existing.modality
      const milestonesChanged = finalModality === 'milestones' &&
        dataToUpdate.milestonesTemplate !== undefined &&
        JSON.stringify(dataToUpdate.milestonesTemplate) !== JSON.stringify(existing.milestonesTemplate || [])

      const shouldRegeneratePayments = modalityChanged || milestonesChanged

      const result = await db.collection(this.collection).updateOne(
        { _id: new ObjectId(id) },
        { $set: dataToUpdate }
      )

      if (result.matchedCount === 0) throw Boom.notFound('Contrato no encontrado')

      // Actualizar estado de unidad si cambió
      if (dataToUpdate.status && dataToUpdate.status !== existing.status) {
        const unitStatus = this.getUnitStatusFromContract(dataToUpdate.status)
        if (unitStatus && existing.unitId) {
          await db.collection('units').updateOne(
            { _id: new ObjectId(existing.unitId) },
            { $set: { status: unitStatus, updatedAt: new Date() } }
          )
        }
      }

      return {
        modified: result.modifiedCount > 0,
        shouldRegeneratePayments
      }
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al actualizar el contrato', error)
    }
  }

  async deleteOneById(id) {
    try {
      if (!ObjectId.isValid(id)) throw Boom.badRequest('El ID del contrato no es válido')

      const contract = await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
      if (!contract) throw Boom.notFound(`No se encontró el contrato con ID ${id}`)

      // Liberar la unidad
      if (contract.unitId && ObjectId.isValid(contract.unitId)) {
        await db.collection('units').updateOne(
          { _id: new ObjectId(contract.unitId) },
          { $set: { status: 'disponible', buyerId: null, updatedAt: new Date() } }
        )
      }

      const result = await db.collection(this.collection).deleteOne({ _id: new ObjectId(id) })
      return result
    } catch (error) {
      if (Boom.isBoom(error)) throw error
      throw Boom.badImplementation('Error al eliminar el contrato', error)
    }
  }

  async addFiles(id, files) {
  try {
    if (!ObjectId.isValid(id)) throw Boom.badRequest('El ID del contrato no es válido')

    const contract = await db.collection(this.collection).findOne({ _id: new ObjectId(id) })
    if (!contract) throw Boom.notFound(`No se encontró el contrato con ID ${id}`)

    const fileRecords = files.map(file => ({
      originalName: file.originalname,
      fileName: file.filename,
      path: file.path,
      size: file.size,
      mimetype: file.mimetype,
      uploadedAt: new Date()
    }))

    const result = await db.collection(this.collection).updateOne(
      { _id: new ObjectId(id) },
      {
        $push: { files: { $each: fileRecords } },
        $set: { updatedAt: new Date() }
      }
    )

    return { filesAdded: fileRecords.length, files: fileRecords }
  } catch (error) {
    if (Boom.isBoom(error)) throw error
    throw Boom.badImplementation('Error al agregar archivos', error)
  }
}

async removeFile(id, fileName) {
  try {
    if (!ObjectId.isValid(id)) throw Boom.badRequest('El ID del contrato no es válido')

    const result = await db.collection(this.collection).updateOne(
      { _id: new ObjectId(id) },
      {
        $pull: { files: { fileName } },
        $set: { updatedAt: new Date() }
      }
    )

    // Eliminar archivo físico
    const filePath = `uploads/contracts/${id}/${fileName}`
    const fs = await import('fs')
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    } 

    return result
  } catch (error) {
    if (Boom.isBoom(error)) throw error
    throw Boom.badImplementation('Error al eliminar archivo', error)
  }
}
}

export default Contracts
