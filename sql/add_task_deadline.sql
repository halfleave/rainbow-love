-- 第10步：日常任务增加「截止时间」
-- 在 Supabase SQL Editor 执行一次即可（已存在则自动跳过）。
alter table tasks
  add column if not exists deadline timestamptz;
