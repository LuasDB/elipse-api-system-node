import { ObjectId } from 'mongodb'
import { db } from './../db/mongoClient.js'
import Boom from '@hapi/boom'
import { sendMail } from '../utils/sendMail.js'
import path from 'path'

class Collection{
  constructor(){

  }
  async create(collection,data){
    try {
      const result = await db.collection(collection).insertOne(data)
      return result
    } catch (error) {
      if(Boom.isBoom(error)){
        throw error
      }else{
      throw Boom.badImplementation('Algo falto aqui para subir',error)}
    }
  }

  async getAll(collection){
    try {
      const collections = await db.listCollections().toArray()
      const collectionExist = collections.some(item=>item.name === collection)
      console.log('Existe?',collectionExist)

      if(!collectionExist){
        throw Boom.notFound(`La colección ${collection} no existe en la base de datos`)
      }

      const result = await db.collection(collection).find().toArray()
      return result || []
    } catch (error) {
      if (Boom.isBoom(error)) {
        throw error
      }
      throw Boom.badImplementation('Error al obtener la colección', error);
    }
  }

  async search(collection,q,page, limit){

    try {
      const pageNumber= Number(page)
      const limitNumber = Number(limit)
      const skip = (pageNumber - 1) * limitNumber

      const totalDocuments = await db.collection(collection)
      .countDocuments({
        descripcion:{$regex:q , $options:"i"}
      })

      const result = await db.collection(collection)
      .find({descripcion:{$regex:q, $options: "i"}})
      .skip(skip)
      .limit(limitNumber)
      .toArray()

      return {data:result,total:totalDocuments,pages:Math.ceil(totalDocuments/limitNumber)}
    } catch (error) {
      if(Boom.isBoom(error)){
        throw error
      }else{
      throw Boom.badImplementation('Algo se recibio mal',error)

    }
  }
  }

  async addFIles(collection,files,data){
    try {

      const newData = {
        ...data,files
      }
      const result = await db.collection(collection).insertOne(newData)
      return result

    } catch (error) {
      if(Boom.isBoom(error)){
        throw error
      }else{
      throw Boom.badImplementation('Algo falto aqui para subir',error)}
    }
  }

  async sendEmail(body){
    const { email,name, message } = body

    await sendMail({
      to:email,
      subject:'Test de envio de mail',
      data:{email,name,message,link:'http://localhost:3000/uploads/pruebas/C.V.MARIOSAULDELAFUENTEBARRUETA__esp2025.pdf'},
      templateEmail:'test',
      attachments:[{
        filename:'samartech',
        path:path.join('uploads/pruebas/samartech.png'),
        cid:'samartech'
      }]
    })


  }

  async getOneById(collection,id){
    try {

      if (!ObjectId.isValid(id)) {
        throw Boom.badRequest('El ID proporcionado no es válido')
      }

      const result = await db.collection(collection).findOne({ _id: new ObjectId(id) })

      if (!result) {
        throw Boom.notFound(`No se encontró un documento con ID ${id} en la colección ${collection}`)
      }

      return result
    } catch (error) {
      if(Boom.isBoom(error)){
        throw error
      }else{
      throw Boom.badImplementation('Sucito un error al obtener la información')
      }
    }
  }

  async updateOneById(collection,id,newData){
    try {

      if(!ObjectId.isValid(id)){
        throw Boom.badRequest('El ID proporcionado no es válido')
      }

      const result = await db.collection(collection).updateOne(
        {_id: new ObjectId(id)},
        { $set: newData}
      )

      if (result.matchedCount === 0) {
        console.log('Paso 1:',result)

        throw Boom.notFound(`No se encontró un documento con ID ${id} en la colección ${collection}`);
      }

      return result

    } catch (error) {
      if(Boom.isBoom(error)){
        throw error
      }else{
        throw Boom.badImplementation('Sucito un error al actualizar la información',error)

      }

    }
  }

  async deleteOneById(collection,id){
    try {
      if(!ObjectId.isValid(id)){
        throw Boom.badData('El ID proporcionado no es válido')
      }

      const result = await db.collection(collection).deleteOne({_id: new ObjectId(id)})

      if(result.deletedCount === 0){
        throw Boom.notFound('No encontrado')
      }

      return result

    } catch (error) {
      if(Boom.isBoom(error)){
        throw error
      }else{
      throw Boom.badImplementation('Algo salio mal con la eliminación de este documento')
      }
    }
  }

}

export default Collection
