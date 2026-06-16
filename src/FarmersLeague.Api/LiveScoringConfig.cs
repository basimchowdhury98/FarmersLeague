static class LiveScoringConfig
{
    public static readonly IReadOnlyDictionary<string, int> PointMultipliers = new Dictionary<string, int>(StringComparer.Ordinal)
    {
        ["goals"] = 10,
        ["ShotsOnTarget"] = 3,
        ["touches_opp_box"] = 1,
        ["dribbles_succeeded"] = 1,
        ["big_chance_missed_title"] = -3,
        ["chances_created"] = 3,
        ["accurate_crosses"] = 1,
        ["shot_blocks"] = 3,
        ["clearances"] = 1,
        ["headed_clearance"] = 1,
        ["interceptions"] = 1,
        ["dribbled_past"] = -3,
        ["saves"] = 3,
        ["goals_prevented"] = 0
    };
}
