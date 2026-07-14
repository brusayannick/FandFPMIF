// The bundled example JVM module: classic Alpha-algorithm process discovery.
// `copyExampleJar` drops the fat jar into modules/alpha_miner_java/dist/ - the
// committed artefact the platform actually runs (`make sdk-jvm` rebuilds it).

plugins {
    java
    application
}

dependencies {
    implementation(project(":sdk"))
}

application {
    mainClass = "mate.modules.alphaminer.AlphaMinerModule"
}

tasks.shadowJar {
    archiveFileName = "alpha-miner-all.jar"
    manifest {
        attributes["Main-Class"] = application.mainClass.get()
    }
}

val copyExampleJar by tasks.registering(Copy::class) {
    dependsOn(tasks.shadowJar)
    from(tasks.shadowJar.flatMap { it.archiveFile })
    into(rootProject.layout.projectDirectory.dir("../../modules/alpha_miner_java/dist"))
}
