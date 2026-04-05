import cron from 'node-cron'
import Attachments from '../services/attachments.service.js'

const attachments = new Attachments()

// Ejecutar cada día a las 2:00 AM
const scheduleFileCleanup = () => {
  // Marcar archivos expirados (eliminar archivos físicos)
  cron.schedule('0 2 * * *', async () => {
    try {
      console.log('🧹 Iniciando limpieza de archivos expirados...')

      const result = await attachments.markExpiredFiles()

      console.log(`✅ Archivos marcados como expirados: ${result.processed}`)
    } catch (error) {
      console.error('❌ Error en limpieza de archivos expirados:', error)
    }
  })

  // Limpiar registros de archivos expirados de la BD (ejecutar semanalmente, domingos 3:00 AM)
  cron.schedule('0 3 * * 0', async () => {
    try {
      console.log('🗑️ Iniciando limpieza de registros expirados en BD...')

      // Eliminar registros de archivos expirados hace más de 7 días
      const result = await attachments.cleanExpiredFiles(7)

      console.log(`✅ Registros eliminados: ${result.deletedCount}`)
    } catch (error) {
      console.error('❌ Error en limpieza de registros BD:', error)
    }
  })

  console.log('⏰ Tareas de limpieza programadas:')
  console.log('   - Marcar archivos expirados: Diario a las 2:00 AM')
  console.log('   - Limpiar registros BD: Domingos a las 3:00 AM')
}

export default scheduleFileCleanup
