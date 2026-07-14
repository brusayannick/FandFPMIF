package mate.modules.alphaminer;

import java.util.List;
import java.util.Map;
import mate.sdk.CallArgs;
import mate.sdk.JobSpec;
import mate.sdk.MateModule;
import mate.sdk.ModuleContext;
import mate.sdk.RouteSpec;

/**
 * The bundled example JVM module: Alpha-algorithm process discovery.
 *
 * <p>On every log import a precompute job mines the Petri net and caches it;
 * {@code GET /model} serves it (mining on demand on a cache miss). The
 * manifest exposes the route as a {@code datasets:} entry with
 * {@code shape: graph}, so the platform's generic visualization renders the
 * net without any module frontend code.
 */
public final class AlphaMinerModule {

    private static final String CACHE_KEY = "model";

    public static void main(String[] argv) {
        MateModule.builder("alpha_miner_java")
                .onEventJob(
                        "mine_on_import",
                        "log.imported",
                        JobSpec.of().progress(true).cancellable(true).title("Alpha Miner"),
                        AlphaMinerModule::mineJob)
                .route("get_model", RouteSpec.get("/model"), AlphaMinerModule::getModel)
                .build()
                .run(argv);
    }

    private static Object mineJob(ModuleContext ctx, CallArgs args) {
        return mine(ctx);
    }

    private static Object getModel(ModuleContext ctx, CallArgs args) {
        return ctx.cache().getJson(CACHE_KEY).orElseGet(() -> mine(ctx));
    }

    private static Map<String, Object> mine(ModuleContext ctx) {
        ctx.progress().update(0.1, "Loading event log");
        List<List<Object>> rows =
                ctx.eventLog()
                        .duckdbFetch(
                                "SELECT case_id, activity FROM events ORDER BY case_id, timestamp",
                                List.of());
        ctx.progress().update(0.4, "Deriving footprint relations");
        Map<String, Object> net = Alpha.mine(rows, ctx::checkCancelled);
        ctx.progress().update(0.9, "Caching model");
        ctx.cache().setJson(CACHE_KEY, net);
        ctx.logger()
                .info(
                        "alpha_model_mined",
                        Map.of("rows", rows.size(), "stats", net.get("stats")));
        ctx.progress().update(1.0);
        return net;
    }

    private AlphaMinerModule() {}
}
