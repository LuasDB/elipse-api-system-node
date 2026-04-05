import { ObjectId } from 'mongodb'
import { db } from './../db/mongoClient.js'
import  Boom  from "@hapi/boom"

class Users{
  constructor(){}

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
      if(!ObjetctId.isValid(id)){
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
  async updateOneById(id, newData){

    try {
      if(!ObjectId.isValid(id)){
        throw Boom.badImplementation(`El ID ${id} no es un ID valido`)
      }

      const { _id,...dataToUpdate } = newData

      const updateOne = await db.collection('users').updateOne(
        {_id: new ObjectId(id)},
        {$set:dataToUpdate}
      )

      if (updateOne.matchedCount === 0) {
        throw Boom.notFound(`No se encontró un documento con ID ${id} en la colección ${collection}`);
      }
      return updateOne
    } catch (error) {
      if(Boom.isBoom(error)){
        throw error
      }else{
      throw Boom.badImplementation('No se pudo editar el usuario',error)}
    }
  }
  async deleteOneById(id){
    try {
      if(!ObjectId.isValid(id)){
        throw Boom.badImplementation(`El ID ${id} no es un ID valido`)
      }
      const deleteUser = await db.collection('users')
      .deleteOne( {_id:new ObjectId(id)})

      if(!deleteUser){
        throw Boom.notFound('El elemento no fue encontrado')
      }

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
