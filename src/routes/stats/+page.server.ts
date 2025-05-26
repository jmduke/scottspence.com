import { turso_client } from '$lib/turso'
import type { Value } from '@libsql/client'

// Base stat type used across different time periods
interface SiteStat {
	views: number
	unique_visitors: number
}

// Monthly statistics
interface MonthlyStat extends SiteStat {
	year_month: string // Format: YYYY-MM
}

// Yearly statistics
interface YearlyStat extends SiteStat {
	year: string // Format: YYYY
}

// Combined site statistics for a page/post
interface SiteStats {
	slug: string
	title: string
	monthly_stats: MonthlyStat[]
	yearly_stats: YearlyStat[]
	all_time_stats: SiteStat
}

// Raw database row type
interface StatsRow {
	slug: Value
	title: Value
	monthly_stats: Value
	yearly_stats: Value
	all_time_stats: Value
}

export const load = async () => {
	const client = turso_client()

	try {
		const result = await client.execute({
			sql: `
				SELECT 
					p.slug,
					p.title,
					-- Get monthly stats using subquery
					COALESCE(
						(SELECT json_group_array(
							json_object(
								'year_month', year_month,
								'views', views,
								'unique_visitors', unique_visitors
							)
						) FROM analytics_monthly 
						WHERE pathname = '/posts/' || p.slug),
						'[]'
					) as monthly_stats,
					-- Get yearly stats using subquery
					COALESCE(
						(SELECT json_group_array(
							json_object(
								'year', year,
								'views', views,
								'unique_visitors', unique_visitors
							)
						) FROM analytics_yearly 
						WHERE pathname = '/posts/' || p.slug),
						'[]'
					) as yearly_stats,
					-- Get all time stats using subquery
					COALESCE(
						(SELECT json_object(
							'views', views,
							'unique_visitors', unique_visitors
						) FROM analytics_all_time 
						WHERE pathname = '/posts/' || p.slug),
						'{"views": 0, "unique_visitors": 0}'
					) as all_time_stats
				FROM posts p
				ORDER BY (
					SELECT COALESCE(views, 0) 
					FROM analytics_all_time 
					WHERE pathname = '/posts/' || p.slug
				) DESC
				LIMIT 500;
			`,
			args: [],
		})

		if (!result.rows || result.rows.length === 0) {
			console.log('No rows returned from database query')
			return {
				site_stats: [],
				current_month: new Date().toISOString().slice(0, 7),
				current_year: new Date().getFullYear().toString(),
			}
		}

		const site_stats: SiteStats[] = result.rows
			.map((row) => {
				try {
					return {
						slug: String(row.slug),
						title: String(row.title),
						monthly_stats: JSON.parse(String(row.monthly_stats)),
						yearly_stats: JSON.parse(String(row.yearly_stats)),
						all_time_stats: JSON.parse(String(row.all_time_stats)),
					}
				} catch (error) {
					console.error('Error parsing row:', error)
					return null
				}
			})
			.filter((item): item is SiteStats => item !== null)

		if (site_stats.length === 0) {
			console.log('No valid site stats found')
			return {
				site_stats: [],
				current_month: new Date().toISOString().slice(0, 7),
				current_year: new Date().getFullYear().toString(),
			}
		}

		// Log some debug info
		console.log(`Loaded ${site_stats.length} posts with stats`)
		if (site_stats.length > 0) {
			console.log('Sample post stats:', {
				slug: site_stats[0].slug,
				monthly_count: site_stats[0].monthly_stats.length,
				yearly_count: site_stats[0].yearly_stats.length,
				all_time_views: site_stats[0].all_time_stats.views,
			})
		}

		return {
			site_stats,
			current_month: new Date().toISOString().slice(0, 7),
			current_year: new Date().getFullYear().toString(),
		}
	} catch (error) {
		console.error('Error fetching from Turso DB:', error)
		return {
			site_stats: [],
			error: 'Error fetching site stats data',
			current_month: new Date().toISOString().slice(0, 7),
			current_year: new Date().getFullYear().toString(),
		}
	} finally {
		client.close()
	}
}
