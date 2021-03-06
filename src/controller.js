/**
 * @namespace Vertebrae
 */
define([
  'jquery',
  'underscore',
  './object',
  './event',
  './stringutils',
  './utils',
  './validator'
], function(
  $, 
  _, 
  BaseObject, 
  BaseEvent, 
  StringUtils,
  Utils,
  Validator) {

  /**
   * Base Controller Object for all Controller
   *
   * @name BaseController
   * 
   * @class BaseController
   * 
   * @memberOf Vertebrae
   * 
   * @augments {Vertebrae.BaseObject}
   */
  var BaseController = BaseObject.extend(/** @lends  Vertebrae.BaseController */{

    /**
     * @description Base properties container for the controller.
     * 
     * @type {Array}
     */
    properties: ['view'],

    events: {
      'view:ready': 'render',
      'view:available': null
    },

    /**
     * Constructor
     *
     * @function
     *
     * @instance
     * 
     * @param  {Object} options
     */
    initialize: function(options) {
      this._unbind = [];

      Utils.setupInstanceObserves(this);
      Utils.setupInstanceEvents(this);

      this.setupView();

      if (!this.getView()) {
        throw new Error('A view was not properly assigned.');
      }

      this.listenToOnce(this.getView(), 'change:available', function() {
        this.trigger('view:available');
        this.viewIsAvailable();
      });
    },

    /**
     * Keep properties on an object in sync with other properties and the view.
     *
     * @function
     *
     * @instance
     * 
     * @param  {String} property The property we want to look at.
     * @param  {Object} options  The object whose properties we want to sync with. 
     * 
     * @return {Object}          
     */
    sync: function(property, options, fn, context) {
      var sections           = String(property).split('.'),
          objPath           = sections.slice(0, -1).join('.'),
          propertyName      = sections.slice(-1).join(''),
          fnController      = null,
          that              = this,
          view              = null,
          hasListened       = false,
          camelProperty     = StringUtils.camelCaseFromNamespace(property),
          camelPropertyName = StringUtils.camelCase(propertyName),
          previousValue     = void(0),
          getter            = null,
          updateOnAvaible   = null,
          updateView        = null,
          getterFn          = null,
          obj               = this,
          fnView            = null,
          filterFn          = function() { return true; };

      if (objPath) {
        obj = BaseObject.getPropertyByNamespace(this, objPath);
      }

      // when we go into this mode then it is just a callback when things change
      if (_.isFunction(options)) {
        context = fn;
        fn = options;
        options = {
          trigger: true,
          targetHandler: null,
          viewHandler: null
        };
      }

      options = _.defaults(options || {}, {
        trigger       : false,
        triggerView   : true,
        accessor      : 'get' + camelPropertyName,
        target        : obj,
        targetHandler : propertyName + 'DidChange',
        viewHandler   : 'refresh' + camelProperty + 'PropertyOnView',
        // you can specific a filter to determine if you should trigger events or not
        filter        : null,
        view          : this.getView(),
        fn            : fn,
        context       : context
      });

      view         = options.view;
      getterFn     = options.accessor;
      fnController = options.targetHandler;
      fnView       = options.viewHandler;
      obj          = options.target;

      if (options.filter) {
        if (_.isString(options.filter) && _.isFunction(this[options.filter])) {
          filterFn = this[options.filter];
        } else if (_.isFunction(options.filter)) {
          filterFn = options.filter;
        }
      }

      // Gets the value for the property on the object we are watching
      getter = function() {
        if (obj[getterFn]) {

          return obj[getterFn]();
        } else {

          return obj.get(propertyName);
        }
      };

      // Update the view but only when the avaiable property has changed
      updateOnAvaible = function(prev) {
        if (hasListened) {

          return;
        }
        hasListened = true;
        that.listenToOnce(view, 'change:available', function() {
          
          hasListened = false;

          updateView(prev);
        });
      };

      // Update the view but only if it is available else queue to update when avaiable changes
      updateView = function(prev) {
        if (that[fnView]) {
          if (view.getAvailable()) {
            that[fnView](getter(), prev);
          } else {
            updateOnAvaible(prev);
          }
        }
      };

      // listen to changes on the given object for the given property
      this.listenTo(obj, 'change:' + propertyName, function() {
        var currentValue = getter();
        if (filterFn.call(this, property)) {
          if (this[fnController]) {
            this[fnController](currentValue, previousValue);
          }
          if (_.isFunction(options.fn)) {
            options.fn.call(options.context || this, currentValue, previousValue);
          }
          updateView(previousValue);
          previousValue = currentValue;
        }
      });

      // We want to immediately update the view to get it in sync with the state of the property we are watching
      if (options.triggerView === true && filterFn.call(this, property)) {
        updateView();
      }

      if (options.trigger === true && obj.trigger) {
        obj.trigger('change:' + propertyName);
      }

      previousValue = getter();

      return this;
    },

    bind: function(eventName, fn, options) {
      options = _.defaults(options || {}, {
        filter: function() {}
      });

      if (options.filter) {
        if (_.isString(options.filter)) {
          options.filter = this[options.filter];
        } else if (!_.isFunction(options.filter)) {
          options.filter = function(){};
        }
      }

      this.listenTo(this, eventName, function() {
        if (options.filter.call(this, eventName)) {
          fn.apply(this, arguments);
        }
      });
      return this;
    },

    isViewAvailable: function() {
      if (this.getView()) {
        return this.getView().isAvailable();
      }
      return false;
    },

    /**
     * Destroying the controller and the view of the controller.
     *
     * @function
     * 
     * @instance
     */
    destroy: function() {
      if (this._unloaded !== true) {
        this.unload();
      }
      this.destroyView();
      this._super.apply(this, arguments);
    },

    /**
     * Destroying the view of the controller.
     *
     * @function
     * 
     * @instance
     */
    destroyView: function() {
      var view = this.getView();
      
      if (view) {
        view.destroy();
      }
      this.setView(null);
    },

    /**
     * Setup the view object(s). This should be something we override when creating child controllers.
     *  
     * @function
     * 
     * @instance
     *
     * @override
     */
    setupView: function() {
      if (this.view) {
        this.setView(new this.view());
      } else {
        throw "'setupView' needs to be overridden";
      }
    },

    /**
     * Sets the element that a view delegates over and tells the view to render.
     *
     * @function
     * 
     * @instance
     * 
     * @param  {Element}  el
     * @param  {Object}   delegate
     *
     * @return {Object} 
     */
    setup: function(el, options) {
      options = _.defaults(options || {}, { delegate: this });
      this.getView().setElement(el);
      this.getView().setDelegate(options.delegate);
      this.getView().watchDelegateProperties();
      this.trigger('setup');
      this.trigger('view:ready');
      this.viewIsReady();
      
      return this;
    },

    /**
     * Called when the view is ready for manipulation.
     *
     * @function
     * 
     * @instance
     * 
     * @override
     */
    viewIsReady: function() {

    },

    render: function() {
      var view = this.getView();
      view.render.apply(view, arguments);
      view.setRendered();
      this.trigger('view:render');
    },

    /**
     * Called once the view is avaiable for manipulation.
     *
     * @function
     *
     * @instance
     *
     * @override
     */
    viewIsAvailable: function() { /* Do nothing. */ },
    
    /**
     * Unload the view.
     *
     * @function
     * 
     * @instance
     * 
     * @param {Function} cb Callback when the view has unloaded
     */
    unload: function(cb) {
      if (this._unloaded !== true) {

        var unbind = this._unbind || [],
            fn     = null;

        while (unbind.length > 0) {
          unbind.pop().call(this);
        }

        this._unloaded = true;
        this.trigger('unload');
        this.getView().unload(cb);
      }
    },

    /**
     * Base validate function that should be overwritten in the extended controllers.
     *
     * @function
     *
     * @instance
     *
     * @override
     * 
     * @return {Bool}
     */
    validate: function() {
      return true;
    }

  });
  
  /**
   * @function Vertebrae.BaseController.extend
   *
   * @function
   * 
   * @static
   * 
   * @param  {Object} proto Prototype definition
   * 
   * @return {Constructor}   
   */
  BaseController.extend = function(proto) {

    Utils.mergeClassProperty(proto, this.prototype, 'observes');
    Utils.mergeClassProperty(proto, this.prototype, 'events');

    if (_.isObject(proto.validators) && !_.isFunction(proto.validate)) {
      proto.validate = function(filters, view) {
        return Validator(this, view, filters); 
      };
    }

    return BaseObject.extend.apply(this, arguments);
  };

  return BaseController;

});