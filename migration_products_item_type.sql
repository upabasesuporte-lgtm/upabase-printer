-- Adiciona o campo "Tipo do item" (Principal / Adicional) usado na impressão
-- pra destacar o prato principal e diminuir os acompanhamentos.
-- Todo produto existente vira "principal" automaticamente (não muda nada).

alter table products
  add column if not exists item_type text not null default 'principal';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_item_type_check'
  ) then
    alter table products
      add constraint products_item_type_check check (item_type in ('principal', 'adicional'));
  end if;
end $$;
