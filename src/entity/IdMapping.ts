import { Entity, Column, PrimaryColumn } from 'typeorm'

@Entity()
export class IdMapping {
  @PrimaryColumn()
  rcId!: string // Rocket.Chat ID of the entity

  @Column()
  matrixId?: string // Matrix ID of the entity

  @Column('integer')
  type!: number // Type of the entity; 0 = user, 1 = room, 2 = message

  @Column({ nullable: true })
  accessToken?: string // Access token for matrix users
}
