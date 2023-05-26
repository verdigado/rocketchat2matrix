import { Entity, PrimaryColumn } from 'typeorm'

@Entity()
export class Membership {
  @PrimaryColumn()
  rcRoomId!: string

  @PrimaryColumn()
  rcUserId!: string
}
