-- ============================================================
-- 影视 · 增加 TMDB 元数据字段（jsonb）
-- 执行时机：到 Supabase Dashboard → SQL Editor 跑本文件一次。
-- 用途：从 TMDB 拉取的影片详情（原名/年份/时长/评分/分级/国家/剧情/剧照/logo/预告片）
--       统一存进 meta jsonb，避免为每类信息单独建列；旧数据 meta 为 null 不受影响。
-- ============================================================

alter table movies add column if not exists meta jsonb;

comment on column movies.meta is
'TMDB 元数据：{ original_title, year, runtime, overview, certification, countries[], genres[], backdrop, logo, trailer_key, poster_original }';
