import { Entity, Column, PrimaryColumn } from 'typeorm'

@Entity()
export class IdMapping {
  @PrimaryColumn()
  rcId!: string

  @Column()
  matrixId?: string

  @Column('integer')
  type!: number
}
