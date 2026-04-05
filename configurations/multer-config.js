import multer from 'multer'
import path from 'path'
import fs from 'fs'

const storageConfig = (collection)=>{
  const uploadPath = `uploads/${collection}`
  if(!fs.existsSync(uploadPath)){
    fs.mkdirSync(uploadPath,{recursive:true})
  }

  return multer.diskStorage({
    destination: (req,file,cb)=>{
      cb(null,uploadPath)
    },
    filename:(req,file,cb)=>{
      const identificador = Date.now() + '_' + Math.round(Math.random() * 1E9)
      cb(null,`${file.fieldname}_${identificador}${path.extname(file.originalname)}`)
    }
  })
}
const upload = (collection)=>{
  return multer({storage:storageConfig(collection)})
}

export default upload
