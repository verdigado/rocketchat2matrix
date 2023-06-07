import winston from 'winston'

export default winston.createLogger({
  level: 'debug',
  transports: [new winston.transports.Console()],
  format: winston.format.combine(
    winston.format.colorize({ all: true }),
    winston.format.simple()
  ),
})
