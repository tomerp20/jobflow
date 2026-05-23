// TODO: implement — see CassandraPlan.md §6 for enrichment design
// Reads company_events where tech_tags is empty, fetches commit details
// from GitHub REST API (15k req/hr authenticated), updates tech_tags.
