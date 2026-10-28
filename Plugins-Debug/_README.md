Connectors here are bundled for Debug builds of Tapestry only, never for release builds (TestFlight and the App Store). Use this folder for connectors that only matter while developing the app.

A connector that once shipped can't simply be moved out of `Plugins/` to here or to `Plugins-Disabled/`: people's devices keep the copy they have. Retire it instead (see "Retiring a connector" in Documentation/API.md).
