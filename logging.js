var winston = require('winston')

module.exports = function (){
  var log = new (winston.Logger)({
    levels: {
      crit    : 0,
      error   : 1,
      warning : 2,
      notice  : 3,
      info    : 4,
      debug   : 5
    },
    colors: {
      crit    : "red",
      error   : "red",
      warning : "yellow",
      notice  : "green",
      info    : "white",
      debug   : "white"
    },
    transports: [
      new (winston.transports.Console)({
        level: 'info',
        colorize: true,
        timestamp: function() {
          var d = new Date()
          // Define time format
          // DD-MM-YYYY hh:mm
          return ("0" + d.getDate()).slice(-2) + "-" +
                 ("0"+(d.getMonth()+1)).slice(-2) + "-" +
                 d.getFullYear() + " " +
                 ("0" + d.getHours()).slice(-2) + ":" +
                 ("0" + d.getMinutes()).slice(-2);
        },
        formatter: function(options) {
          // Require config to use colors in custom formatter
          var config = require('winston/lib/winston/config');
          // Define custom log formater
          // [LEVEL] My log message
          var msg = '[' + options.level.toUpperCase() + '] ' +
                    (undefined !== options.message ? options.message : '') +
                    (options.meta && Object.keys(options.meta).length ? '\n\t' +
                    JSON.stringify(options.meta) : '' );

          return options.timestamp() + ' ' + config.colorize(options.level, msg)
        }
      }),
      new (winston.transports.File)({
        json: false,
        level: 'info',
        filename: 'main.log'
      })
    ]
  })

  return log
}
