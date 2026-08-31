import { ObjectId } from 'mongodb'
import { db } from '../db/mongoClient.js'
import  Boom  from "@hapi/boom"
import bcrypt from 'bcrypt'
import AuditLog from './auditLog.service.js'
import { diff } from '../utils/audit.util.js'

class Users{
  constructor(){
    this.auditLog = new AuditLog()
  }

  async getAll(filters = {}){
    try {
      const query = {}

      if (filters.role) query.role = filters.role;
      if (filters.active !== undefined) query.active = filters.active;
      if (filters.search) {
        query.$or = [
          { name: { $regex: filters.search, $options: 'i' } },
          { email: { $regex: filters.search, $options: 'i' } }
        ]
      }

      const users = await db.collection('users').find(
        query,
        {projection:{password:0}})
        .sort({createdAt:-1}).toArray()

      return users

    } catch (error) {
      if(Boom.isBoom(error)){
        throw error
      }else{
      throw Boom.badImplementation('No se pudo traer a todos los usuarios',error)}
    }
  }
  async getOneById(id){
    try {
      if(!ObjectId.isValid(id)){
        throw Boom.badImplementation(`El ID ${id} no es un ID valido`)
      }
      const user = await db.collection('users')
      .findOne( {_id:new ObjectId(id)},
                {projection:{password:0}})

      if(!user){
        throw Boom.notFound('El elemento no fue encontrado')
      }

      return user

    } catch (error) {
      if(Boom.isBoom(error)){
        throw error
      }else{
      throw Boom.badImplementation('No se pudo traer a todos los usuarios',error)}
    }
  }
  async updateOneById(id, newData, context){

    try {
      if(!ObjectId.isValid(id)){
        throw Boom.badImplementation(`El ID ${id} no es un ID valido`)
      }

      const { _id,...dataToUpdate } = newData

      const existing = await db.collection('users').findOne({ _id: new ObjectId(id) })
      if (!existing) {
        throw Boom.notFound(`No se encontró un documento con ID ${id}`)
      }

      const passwordChanged = !!dataToUpdate.password
      if(dataToUpdate.password){
        dataToUpdate.password = await bcrypt.hash(dataToUpdate.password, 10)
      }

      const updateOne = await db.collection('users').updateOne(
        {_id: new ObjectId(id)},
        {$set:dataToUpdate}
      )

      if (updateOne.matchedCount === 0) {
        throw Boom.notFound(`No se encontró un documento con ID ${id}`);
      }

      const changes = diff(existing, dataToUpdate) // password se ignora en el diff
      if (passwordChanged) changes.push({ field: 'password', from: '***', to: '***' })
      if (changes.length) {
        await this.auditLog.record({
          entity: 'user',
          entityId: id,
          entityLabel: existing.name || existing.email,
          action: 'updated',
          actor: context?.actor,
          changes,
          meta: context ? { ip: context.ip } : null
        })
      }
      return updateOne
    } catch (error) {
      if(Boom.isBoom(error)){
        throw error
      }else{
      throw Boom.badImplementation('No se pudo editar el usuario',error)}
    }
  }
  async deleteOneById(id, context){
    try {
      if(!ObjectId.isValid(id)){
        throw Boom.badImplementation(`El ID ${id} no es un ID valido`)
      }

      const existing = await db.collection('users').findOne({ _id: new ObjectId(id) })

      const deleteUser = await db.collection('users')
      .deleteOne( {_id:new ObjectId(id)})

      if(!deleteUser){
        throw Boom.notFound('El elemento no fue encontrado')
      }

      await this.auditLog.record({
        entity: 'user',
        entityId: id,
        entityLabel: existing?.name || existing?.email,
        action: 'deleted',
        actor: context?.actor,
        snapshot: existing, // password se redacta en auditLog.record()
        meta: context ? { ip: context.ip } : null
      })

      return deleteUser

    } catch (error) {
      if(Boom.isBoom(error)){
        throw error
      }else{
      throw Boom.badImplementation('No se pudo traer a todos los usuarios',error)}
    }
  }
}

export default Users
