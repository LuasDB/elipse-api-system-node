import multer from 'multer'
import path from 'path'
import fs from 'fs'

const contractStorage = (contractId) =>{
    const uploadPath = `uploads/contracts/${contractId}`
    if(!fs.existsSync(uploadPath)){
        fs.mkdirSync(uploadPath, {recursive:true})
    }
    return multer.diskStorage({
        destination: (req,file,cb)=>{
            cb(null,uploadPath)
        },
        filename:(req,file,cb)=>{
            const timestamp = Date.now() + '_' + Math.round(Math.random() * 1E9)
            const ext = path.extname(file.originalname)
            const safeName = file.originalname
                .replace(ext,'')
                .replace(/[^a-zA-Z0-9_-]/g,'_')
                .substring(0,50)
            cb(null,`${safeName}_${timestamp}${ext}`)
        }
    })
}

const uploadContractFiles = (contractId)=>{
    return multer({
        storage:contractStorage(contractId),
        limits:{fileSize:10*1024*1024}, //10MB por archivo
        fileFilter:(req,file,cb)=>{
            const allowedTypes = [
                'application/pdf',
                'image/jpeg', 'image/png', 'image/webp',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.ms-excel',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            ]
            if(allowedTypes.includes(file.mimetype)){
                cb(null,true)
            }else{
                cb(new Error('Tipo de archivo no permitido. Solo PDF, imágenes, Word y Excel.'))
            }
        }
    })

}

export default uploadContractFiles