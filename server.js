import express from 'express'
import cors from 'cors'
import AppRouter from './routes/index.js'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { logErrors,errorHandler} from './middlewares/hanldeErrors.js'
import { client } from './db/mongoClient.js'
import swaggerUi from 'swagger-ui-express'
import { readFile } from 'fs/promises'
import scheduleFileCleanup from './utils/fileCleanup.util.js'


const data = await readFile('./api_documentation_swaggerUi.json', 'utf-8')
const swaggerDoc = JSON.parse(data)

const port = 3000 || process.env.PORT
//Express
const app = express()
app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc))
//Ejecutamos CORS, primero crearemos las url a las que le daremos acceso
  // const whitelist = ['http://localhost:3000','http://127.0.0.1'];
  // const options ={
  //   origin: (origin,callback)=>{
  //     if(whitelist.includes(origin) || !origin){
  //       callback(null,true);
  //     }else{
  //       callback(new Error('No permitido'));
  //     }
  //   }
  // }

// app.use(cors(options));

// para todas las url
app.use(cors())
//Socket.io
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST","GET", "POST", "PATCH", "DELETE"]
  }
})
io.on('connection', (socket) => {
  console.log('Usuario conectado', socket.id)
  socket.on('disconnect', () => {
    console.log('Usuario desconectado', socket.id)
  });

  socket.on('chat message', (msg) => {
    console.log('Mensaje recibido:', msg)
    socket.emit('response', `Mensaje recibido: ${msg}`)
  });


})

const startServer = async ()=>{
  try {
    await client.connect()
    console.log('✅ Conectado a MongoDB')

    //Rutas
    AppRouter(app,io)
    app.use(logErrors)
    app.use(errorHandler)
    //Estaticos en caso de usar almacenamiento en el servidor
    app.use('/uploads', express.static('uploads'))
    // Iniciar tareas programadas de limpieza
    scheduleFileCleanup()
    //Iniciar el servidor
    httpServer.listen(3000,()=>{
      console.log(`🚀 Servidor iniciado en puerto: ${port}`)
      console.log(`📚 Documentación API: http://localhost:${port}/api-docs`)
    })

  } catch (error) {
    console.error('❌ Error al conectar con MongoDB:', error)
    process.exit(1)
  }
}

process.on('SIGINT', async () => {
  await client.close()
  console.log('🛑 Conexión con MongoDB cerrada')
  process.exit(0)
})

startServer()



