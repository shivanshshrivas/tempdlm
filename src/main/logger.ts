import log from "electron-log/main";

// Keep verbose path/process diagnostics disabled unless explicitly requested.
const DEFAULT_LOG_LEVEL = "info";
const logLevel = process.env.TEMPDLM_LOG_LEVEL === "debug" ? "debug" : DEFAULT_LOG_LEVEL;

log.transports.file.level = logLevel;
log.transports.console.level = logLevel;

export default log;
