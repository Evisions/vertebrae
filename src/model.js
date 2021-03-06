/**
 * @namespace Vertebrae
 */
define([
  'jquery',
  'underscore',
  'bluebird',
  './object',
  './stringutils'
], function(
    $, 
    _, 
    Promise,
    BaseObject,
    StringUtils) {

  var optionalParam = /\((.*?)\)/g,
      namedParam    = /(\(\?)?:\w+/g,
      splatParam    = /\*\w+/g,
      escapeRegExp  = /[\-{}\[\]+?.,\\\^$|#\s]/g;

  /**
   * Base Model Class for All Project Models
   *
   * @name BaseModel
   * 
   * @class BaseModel
   * 
   * @memberOf Vertebrae
   * 
   * @augments {Vertebrae.BaseObject}
   */
  var BaseModel = BaseObject.extend(/** @lends  Vertebrae.BaseModel */{

    /**
     * Setup the object
     *
     * @function
     *
     * @instance
     *
     * @param  {Object} props Properties to apply to the model.
     */
    initialize: function(props) {
      if (_.isFunction(this.defaults)) {
        props = _.defaults(_.clone(props), this.defaults());
      }

      this.applyProperties(props);

      return this._super();
    },

    /**
     * Update this model with the properties from another model.
     *
     * @function
     *
     * @instance
     *
     * @param  {Vertebrae.BaseModel} model
     *
     * @return {Vertebrae.BaseModel}
     */
    updateWith: function(model) {
      this.applyProperties(model.getProperties());

      return this;
    },

    /**
     * Converting server propeties to an object that can be converted to JSON.
     *
     * @function
     *
     * @instance
     * 
     * @return {Object} Object that we are going to be converting to JSON.
     */
    toJSON: function() {
      var properties = {};

      if (this.serverProperties && this.serverProperties.length) {
        properties = _.pick(this, this.serverProperties);
      }

      return properties;
    }

  },/** @lends Vertebrae.BaseModel */{

    /**
     * @description Default timeout value for API calls.
     * 
     * @type {Number}
     */
    timeout: 30000,

    /**
     * @description The specific parsers used for handling the model's API response.
     *
     * @type {Object}
     */
    parsers: {},

    /**
     * @description The root of all URI calls from this model.
     *
     * @type {String}
     */
    rootURI: '/',

    /**
     * If no parser is specified for a request, then we use this default handler.
     *
     * @function
     *
     * @static
     *
     * @param  {Object} data
     *
     * @return {Object}
     */
    defaultHandler: function(data) {
      return data;
    },

    /**
     * Getting a new instance of the passed model.
     *
     * @function
     *
     * @static
     *
     * @param  {Object} data The model you would like to instance.
     *
     * @return {Object}
     */
    model: function(data) {
      return new this(data);
    },

    /**
     * Getting an array of new model instances based of the array of model passed.
     *
     * @function
     *
     * @static
     *
     * @param  {Array} arr An array of models to instance.
     *
     * @return {Array}
     */
    models: function(arr) {
      var modelArray  = [],
          len         = (arr || []).length,
          i           = 0;

      for (i = 0; i < len; ++i) {
        modelArray.push(this.model(arr[i]));
      }

      return modelArray;
    },

    /**
     * Getting the AJAX timeout value.
     *
     * @function
     *
     * @static
     *
     * @return {Number} The value to set the AJAX timeout.
     */
    getAjaxTimeout: function() {
      return Number(this.timeout) || 500;
    },


    /**
     * Make a request to an API.
     *
     * @function
     *
     * @static
     *
     * @param  {String} uri     The specific URI to call.
     * @param  {Object} params  The data to send.
     * @param  {Object} options Options to go with the request.
     *
     * @return {Promise}
     */
    request: function(uri, params, options) {
      options || (options = {});
      params || (params = {});

      var that             = this,
          responseDefaults = this.getResponseDefaults(),
          url              = (this.rootUrl || this.rootURI) + uri;

      _.defaults(options, {
        data     : params,
        url      : url
      });

      options.timeout = this.getAjaxTimeout();

      if (options.jsonBody) {
        options.contentType = 'application/json';
        options.data = JSON.stringify(options.data);
        options.processData = false;
      }

      return this.ajax(options)
        .then(function() {
          return that.processResponse.apply(that, arguments);
        })
        .then(function(payload) {
          var modelizer = that.getParser(uri, options.type) || that.defaultHandler;
          return that.resolve(modelizer.call(that, payload, params) || {});
        });
    },

    processResponse: function(resp, textStatus, xhr) {
      if (this.getResponseDefaults()) {
        resp = _.defaults(resp || {}, this.getResponseDefaults());
      }
        // If we have a NULL response,= or it is not valid then we reject.
      if (!this.isValidResponse(resp || {}, textStatus, xhr)) {
        return this.reject(this.getResponseFailPayload(resp || {}));
      } else {
        // If it is valid, then we just return the response.
        return this.getResponseSuccessPayload(resp || {});
      }
    },

    ajax: function(options) {
      return Promise.resolve(Backbone.ajax(options));
    },

    reject: function(resp) {
      return Promise.reject(resp);
    },

    resolve: function(data) {
      return Promise.resolve(data);
    },

    isValidResponse: function(resp) {
      return !!resp;
    },

    getResponseDefaults: function() {
      return null;
    },

    getResponseSuccessPayload: function(resp) {
      return resp;
    },

    getResponseFailPayload: function(resp) {
      return resp;
    },

    /**
     * Getting the parse for a URI request for a specific type.
     *
     * @function
     *
     * @static
     * 
     * @param  {String} uri  URI of the request we are trying to parse.
     * @param  {String} type The type of request we are trying to parse.
     * 
     * @return {Object}      The callback of the FOUND parser.
     */
    getParser: function(uri, type) {
      var parsers = this._parsers || [],
          len     = parsers.length,
          i       = 0,
          parser  = null;

      type = String(type).toLowerCase();

      for (i = 0; i < len; ++i) {
        parser = parsers[i];
        if (parser.type && parser.type !== type) {
          // If we specify a type of call and it does not match the given type, then continue.
          continue;
        }
        if (parser.uri.test(uri)) {
          return parser.callback;
        }
      }
    },

    /**
     * Taking the model request and executing it as a POST.
     *
     * @function
     *
     * @static
     *
     * @param  {Stirng} uri Destination of the API call.
     * @param  {Object} params Parameters to pass into the API call.
     * @param  {Object} options Options to use during the API call.
     *
     * @return {Object}
     */
    post: function(uri, params, options) {
      return this.request(uri, params, _.defaults(options || {}, { type: 'POST' }));
    },

    /**
     * Taking the model request and executing it as a GET.
     *
     * @function
     *
     * @static
     *
     * @param  {Stirng} uri Destination of the API call.
     * @param  {Object} params Parameters to pass into the API call.
     * @param  {Object} options Options to use during the API call.
     *
     * @return {Object}
     */
    get: function(uri, params, options) {
      return this.request(uri, params, _.defaults(options || {}, { type: 'GET' }));
    },

    /**
     * Taking the model request and executing it as a PUT.
     *
     * @function
     *
     * @static
     *
     * @param  {Stirng} uri Destination of the API call.
     * @param  {Object} params Parameters to pass into the API call.
     * @param  {Object} options Options to use during the API call.
     *
     * @return {Object}
     */
    put: function(uri, params, options) {
      return this.request(uri, params, _.defaults(options || {}, { type: 'PUT', jsonBody: true }));
    },

    /**
     * Taking the model request and executing it as a DELETE.
     *
     * @function
     *
     * @static
     *
     * @param  {Stirng} uri Destination of the API call.
     * @param  {Object} params Parameters to pass into the API call.
     * @param  {Object} options Options to use during the API call.
     *
     * @return {Object}
     */
    del: function(uri, params, options) {
      return this.request(uri, params, _.defaults(options || {}, { type: 'DELETE' }));
    },

    /**
     * Generating an API link based off the past URL. The rootURI will be appended to the API calls.
     *
     * @function
     *
     * @static
     * 
     * @param  {String} uri The destination of the API request we are trying to make.
     * 
     * @return {String}     Built string for the API request.
     */
    generateLink: function(uri) {
      return window.location.protocol + '//' + window.location.host + this.rootURI + uri;
    }

  });

  function createModelRequestMethods(map) {
    var routes       = {},
        createMethod = null,
        crud         = ['POST', 'GET', 'PUT', 'DEL'],
        crudMethods  = null;

    crudMethods  = {
      POST : 'requestCreate',
      GET  : 'requestOne',
      PUT  : 'requestUpdate',
      DEL  : 'requestDelete'
    };

    createMethod = function(options, route) {
      var sections     = String(route).trim().split(/\s+/),
          method       = String(sections[0]).trim().toLowerCase(),
          fn           = null,
          uri          = sections.slice(1).join('');


      if (_.isString(options)) {
        fn = options;
        options = null;
      } else if (_.isObject(options)) {
        fn = options.fn;
      } else  {
        throw new Error('The value of the model route mapping must be a string or an object.');
      }


      if (method == 'delete') {
        method = 'del';
      } else if (method == 'crud') {
        // if the crud method is given then we want to auto-generate the default crud interface
        // name = 'document', route = 'CRUD document'
        // generated functions:
        // requestCreateDocument -> POST document
        // requestOneDocument -> GET document/:$0
        // requestUpdateDocument -> PUT document/:id
        // requestDeleteDocument -> DEL document/:id
        _.each(crud, function(m) {
          var newRoute = m + ' ' + uri;

          switch (m) {
            case 'GET':
              newRoute += '/:$0';
              break;
            case 'PUT':
            case 'DEL':
              newRoute += '/:id';
              break;
          };

          createMethod(crudMethods[m] + StringUtils.camelCase(fn), newRoute);
        });
        // we don't actually want to create a method for CRUD so return
        return;
      }

      routes[fn] = function(params, opts) {
        var args     = arguments,
            counter  = 0,
            toDelete = [],
            data     = _.clone(params);

        var replacedUri = String(uri)
            .replace(/:[\$]?\w+/g, function(match) {
              var name  = match.slice(1),
                  value = null;

              if (name[0] == '$') {
                // if we have the $ then we use args for the data
                value = args[counter++];
                
                return value;
              } else if (data && data[name]) {
                value = data[name]; 
                toDelete.push(name);
                return value;
              } else {

                throw new Error('The route ' + route + ' must include ' + name + ' in your params');
              }
            });

        data    = _.clone(args[counter++]) || {};
        opts = _.clone(args[counter]) || {};

        _.each(toDelete, function(prop) {
          delete data[prop];
        });

        if (options) {
          _.defaults(opts, options);
        }

        return this[method](replacedUri, data, opts);
      };
    };

    _.each(map, createMethod);

    return routes;
  };


  /**
   * Parsing through the set of parsers to find the matching route.
   *
   * @function
   *
   * @static
   * 
   * @return {Object} Parser object with the matching route. Includes the callback function and type of parser.
   */
  function parseParsers(stat) {
    var rootURI = stat.rootURI;

    return _.map(stat.parsers || {}, function(fn, route) {
      var sections  = route.split(/\s+/),
          hasMethod = sections.length > 1,
          type      = hasMethod ? String(sections[0]).trim().toLowerCase() : null,
          route     = hasMethod ? sections.slice(1).join('') : sections.join('');

      // See if we have any type specific items.
      if (route[0] == '#') {
        var lastHashIndex = route.slice(1).indexOf('#') + 1;

        type = route.slice(1, lastHashIndex).toLowerCase();
        route = route.slice(lastHashIndex + 1);
      }

      route = (route).replace(escapeRegExp, '\\$&')
                    .replace(optionalParam, '(?:$1)?')
                    .replace(namedParam, function(match, optional) {
                      return optional ? match : '([^\/]+)';
                    })
                    .replace(splatParam, '(.*?)');

      if (_.isString(fn)) {
        var fnName = fn;
        fn = function() {
          return this[fnName].apply(this, arguments);
        };
      }

      return { 
        uri       : new RegExp('^' + route + '$'),
        callback  : fn, 
        type      : type 
      };
    });
  };

  BaseModel.extend = function(proto, stat) {
    // See if the static properties has a parsers object.
    if (this.parsers && stat && stat.parsers) {
      stat._parsers = parseParsers(stat).concat(this._parsers || []);
    }

    if (stat && stat.routes) {
      _.extend(stat, createModelRequestMethods(stat.routes));
    }

    // Extends properties with server properties.
    var serverProperties = [],
        properties       = [];

    if (_.isArray(proto.serverProperties)) {
      serverProperties = proto.serverProperties;
      if (_.isArray(proto.properties)) {
        properties = proto.properties;
      }
      proto.properties = [].concat(serverProperties, properties);
    }

    return BaseObject.extend.apply(this, arguments);
  };

  return BaseModel;

});