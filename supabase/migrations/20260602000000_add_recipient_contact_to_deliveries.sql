alter table deliveries
  add column recipient_name  text not null default '',
  add column recipient_phone text not null default '',
  add column delivery_notes  text,
  add column sender_phone    text;

alter table deliveries
  alter column recipient_name  drop default,
  alter column recipient_phone drop default;
