import winston from 'winston'

export default winston.createLogger({
  level: 'debug',
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: 'warn.log',
      level: 'warn',
      silent: process.env.NODE_ENV === 'test',
      options: { flags: 'w' },
    }),
    new winston.transports.File({
      filename: 'combined.log',
      silent: process.env.NODE_ENV === 'test',
      options: { flags: 'w' },
    }),
  ],
  format: winston.format.combine(
    winston.format.colorize({ all: true }),
    winston.format.simple()
  ),
})
