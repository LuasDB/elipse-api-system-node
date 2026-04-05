import { db } from './../db/mongoClient.js'
import Boom from '@hapi/boom'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import config from '../config.js'
import { sendMail } from './../utils/sendMail.js'
import path from 'path'

class Auth{
  constructor(){
    this.jwtSecret = this.jwtSecret,
    this.jwtExpiration='1h'
  }

  async create(data){

    try {
      const { name, email, password } = data
      if(!name || !email ){
        throw Boom.badData('Todos los datos son necesarios')
      }

      const user = await db.collection('users').findOne({email:email})

      if(user){
        throw Boom.conflict(`El usuario con correo ${email} ya existe`);
      }

      if(password){
        const hashedPassword = await bcrypt.hash(password,10);
        data.password = hashedPassword
      }


      const result = await db.collection('users').insertOne(data)

      if(result.insertedId){
        const resetToken = jwt.sign(
          { userId: result.insertedId,email },
          this.jwtSecret,
          { expiresIn: '1h' }
        );

        const resetLink = `${config.urlApp}/reset-password?token=${resetToken}`
        if(!password){
          sendMail({
            to:email,
            subject:'Creación de contraseña',
            data:{name,company,resetLink},
            templateEmail:'register',
            attachments:[{
              filename:'samartech',
              path:path.join('emails/samartech.png'),
              cid:'logo_empresa'
            }]
          })
        }

        return {id:result.insertedId,email}

      }

    } catch (error) {
      if(Boom.isBoom(error)){
        throw error
      }
      throw Boom.badImplementation('Error al registrar usuario',error)

    }

  }

  async login(data){
    try {
      const { password,email } = data
      const user = await db.collection('users').findOne({email})

      if(!user){
        throw Boom.unauthorized('Email o passwor incorrectos')
      }

      const isPasswordValid = await bcrypt.compare(password,user.password)

      if(!isPasswordValid){
        throw Boom.unauthorized('Email o passwor incorrectos')
      }
      delete user.password

      const payload = user

      const token = jwt.sign(payload,this.jwtSecret,{ expiresIn:'5h'})

      return token

    } catch (error) {
      if(Boom.isBoom(error)){
        throw error
      }
      throw Boom.badImplementation('Error al registrar usuario',error)
    }
  }

  async forgotPassword(data){
    try {
      console.log(data)
      const { email } = data
      const user = await this.getUserByEmail(email)

      const resetToken = jwt.sign(
        { userId: user._id,email:user.email },
        this.jwtSecret,
        { expiresIn: '1min' }
      );

      const resetLink = `${config.urlApp}/reset-password?token=${resetToken}`
      sendMail({
        to:email,
        subject:'Creación de contraseña',
        data:{name:user.name,resetLink},
        templateEmail:'restartPass',
        attachments:[{
          filename:'samartech',
            path:path.join('emails/samartech.png'),
            cid:'logo_empresa'
        }]
      })
      return 'Se ha enviado un enlace de restablecimiento de contraseña a tu correo.'
    } catch (error) {
      if(Boom.isBoom(error)){
        throw error
      }
      throw Boom.badImplementation('Error al registrar usuario',error)
    }
  }

  async getUserByEmail(email){
    try {
      const user = await db.collection('users').findOne({email:email})
      if (!user) {
        throw Boom.notFound('No se encontró un usuario con ese correo');
      }

      return user

    } catch (error) {
      if(Boom.isBoom(error)){
        throw error
      }
      throw Boom.badImplementation('Error al registrar usuario',error)
    }
  }

  async resetPassword(token, newPassword){
    try {
      const decoded = jwt.verify(token,this.jwtSecret)

      const user = this.getUserByEmail(decoded.email)

      const hashedPassword = await bcrypt.hash(newPassword,10)

      await db.collection('users').updateOne(
        {_id:user._id},
        {$set:{password:hashedPassword}}
      )

      return { message:'Contraseña actualizada' }
    } catch (error) {
      if(Boom.isBoom(error)){
        throw error
      }
      throw Boom.badImplementation('Error al registrar usuario',error)
    }
  }


}

export default Auth
