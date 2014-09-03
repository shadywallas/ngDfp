'use strict';

var googletag     = googletag || {};
    googletag.cmd = googletag.cmd || [];

angular.module('ngDfp', [])
  .constant('ngDfpUrl', '//www.googletagservices.com/tag/js/gpt.js')

  .provider('DoubleClick', ['ngDfpUrl', function (ngDfpUrl) {
    /**
     Holds slot configurations.
     */
    var slots = {};

    /**
     Defined Slots, so we can refresh the ads
     */
    var definedSlots = {};

    /** 
     If configured, all ads will be refreshed at the same interval
     */
    var refreshInterval = null;

    /**
     This initializes the dfp script in the document. Loosely based on angular-re-captcha's
     method of loading the script with promises.

     @link https://github.com/mllrsohn/angular-re-captcha/blob/master/angular-re-captcha.js
     */
    this._createTag = function (callback) {
      var gads   = document.createElement('script'),
          useSSL = 'https:' === document.location.protocol,
          node   = document.getElementsByTagName('script')[0];

      gads.async = true;
      gads.type  = 'text/javascript';
      gads.src   = (useSSL ? 'https:' : 'http:') + ngDfpUrl;
      
      // Insert before any JS include.
      node.parentNode.insertBefore(gads, node);

      gads.onreadystatechange = function() {
        if (this.readyState == 'complete') {
          callback();
        }
      };

      gads.onload = callback;
    };

    /**
     Initializes and configures the slots that were added with defineSlot.
     */
    this._initialize = function () {
      angular.forEach(slots, function (slot, id) {
        definedSlots[id] = googletag.defineSlot.apply(null, slot).addService(googletag.pubads());
      });

      googletag.pubads().enableSingleRequest();
      googletag.enableServices();

      googletag.pubads().addEventListener('slotRenderEnded', this._slotRenderEnded);
    };

    this._slotRenderEnded = function (event) {
      var callback = slots[event.slot.getSlotId().getDomId()].renderCallback;
      
      if (typeof callback === 'function') {
        callback();
      }
    };

    /**
     Returns the global refresh interval
     */
    this._refreshInterval = function () {
      return refreshInterval;
    };

    /**
     Allows defining the global refresh interval
     */
    this.setRefreshInterval = function (interval) {
      refreshInterval = interval;

      // Chaining
      return this;
    };

    /**
     Stores a slot definition.
     */
    this.defineSlot = function () {
      var slot = arguments;

      slot.getSize = function () {
        return this[1];
      };

      slot.setRenderCallback = function (callback) {
        this.renderCallback = callback;
      };

      slots[arguments[2]] = slot;

      // Chaining.
      return this;
    };

    // Public factory API.
    var self  = this;
    this.$get = ['$q', '$window', '$interval', function ($q, $window, $interval) {
      // Neat trick from github.com/mllrsohn/angular-re-captcha
      var deferred = $q.defer();

      self._createTag(function () {
        self._initialize();

        if (self._refreshInterval() !== null) {
          $interval(function () {
            $window.googletag.pubads().refresh();
          }, self._refreshInterval());
        }

        deferred.resolve();
      });
      
      return {
        /**
         More than just getting the ad size, this 
         allows us to wait for the JS file to finish downloading and 
         configuring ads

         @deprecated Use getSlot().getSize() instead.
         */
        getAdSize: function (id) {
          return deferred.promise.then(function () {
            // Return the size of the ad. The directive should construct
            // the tag by itself.
            var slot = slots[id];

            if (angular.isUndefined(slot)) {
              throw 'Slot ' + id + ' has not been defined. Define it using DoubleClickProvider.defineSlot().';
            }

            return slots[id][1];
          });
        },

        getSlot: function (id) {
          return deferred.promise.then(function () {
            // Return the size of the ad. The directive should construct
            // the tag by itself.
            var slot = slots[id];

            if (angular.isUndefined(slot)) {
              throw 'Slot ' + id + ' has not been defined. Define it using DoubleClickProvider.defineSlot().';
            }

            return slots[id];
          });
        },

        runAd: function (id) {
          $window.googletag.display(id);
        },

        /**
         Refreshes an ad by its id or ids.

         Example:

             refreshAds('div-123123123-2')
             refreshAds('div-123123123-2', 'div-123123123-3')
         */
        refreshAds: function () {
          var slots = [];

          angular.forEach(arguments, function (id) {
            slots.push(definedSlots[id]);
          });

          $window.googletag.pubads().refresh(slots);
        }
      };
    }];
  }])

  .directive('ngDfpAdContainer', function () {
    return {
      restrict: 'A',
      controller: ['$element', function ($element) {
        function hide(mode) {
          if (mode === 'visibility') {
            $element.css('visibility', 'hidden');
          }
          else {
            $element.hide();
          }
        }

        function show(mode) {
          if (mode === 'visibility') {
            $element.css('visibility', 'visible');
          }
          else {
            $element.show();
          }
        }

        this.$$setVisible = function (visible, mode) {
          if (visible) {
            show(mode);
          }
          else {
            hide(mode);
          }
        };
      }]
    };
  })

  .directive('ngDfpAd', ['$timeout', '$parse', '$interval', 'DoubleClick', function ($timeout, $parse, $interval, DoubleClick) {
    return {
      restrict: 'A',
      template: '<div id="{{adId}}"></div>',
      require: '?^ngDfpAdContainer',
      scope: {
        adId: '@ngDfpAd',
        interval: '@ngDfpAdRefreshInterval'
      },
      replace: true,
      link: function (scope, element, attrs, ngDfpAdContainer) {
        scope.$watch('adId', function (id) {
          // Get rid of the previous ad.
          element.html('');

          var intervalPromise = null;

          DoubleClick.getSlot(id).then(function (slot) {
            var size = slot.getSize();

            element.css('width', size[0]).css('height', size[1]);
            $timeout(function () {
              DoubleClick.runAd(id);
            });

            // Only if we have a container we hide this thing
            if (ngDfpAdContainer) {
              slot.setRenderCallback(function () {
                if (angular.isDefined(attrs.ngDfpAdHideWhenEmpty)) {
                  if (element.find('iframe:not([id*=hidden])')
                             .map(function () { return this.contentWindow.document; })
                             .find("body")
                             .children().length === 0) {
                    // Hide it
                    ngDfpAdContainer.$$setVisible(false, attrs.ngDfpAdHideWhenEmpty);
                  }
                  else {
                    ngDfpAdContainer.$$setVisible(true, attrs.ngDfpAdHideWhenEmpty);
                  }
                }
              });
            }

            // Refresh intervals
            scope.$watch('interval', function (interval) {
              if (angular.isUndefined(interval)) {
                return;
              }

              // Cancel previous interval
              $interval.cancel(intervalPromise);

              intervalPromise = $interval(function () {
                DoubleClick.refreshAds(id);
              }, scope.interval);
            });
          });
        });
      }
    };
  }]);
 