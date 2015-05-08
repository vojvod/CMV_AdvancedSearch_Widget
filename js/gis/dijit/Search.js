define([
    // basics
    '../../viewer/Controller',
    'dojo/_base/declare',
    'dojo/_base/lang',
    'dojo/aspect',
    'dojo/_base/array',

    'dojo/on',
    'dojo/keys',

    'esri/geometry/Point',

    'esri/tasks/GeometryService',
    'esri/tasks/BufferParameters',
    'esri/SpatialReference',

    'esri/tasks/QueryTask',
    'esri/tasks/query',
    'esri/dijit/FeatureTable',
    'dijit/registry',
    'dojo/promise/all',

    'dijit/TooltipDialog',
    'dijit/popup',
    'dojox/widget/Standby',

    'esri/dijit/Geocoder',
    'dojo/dom',
    'dojo/dom-construct',
    'dojo/dom-style',
    'dojo/dom-class',

    'put-selector',

    '//cdnjs.cloudflare.com/ajax/libs/proj4js/2.2.1/proj4.js',

    'dojo/store/Memory',
    'esri/tasks/IdentifyTask',

    'dojo/data/ItemFileWriteStore',

    'dojo/_base/Color',
    'esri/toolbars/draw',
    'dojo/topic',
    'esri/layers/GraphicsLayer',
    'esri/graphic',
    'esri/renderers/UniqueValueRenderer',
    'esri/renderers/SimpleRenderer',
    'esri/symbols/SimpleMarkerSymbol',
    'esri/symbols/SimpleLineSymbol',
    'esri/symbols/SimpleFillSymbol',

    // mixins & base classes
    'dijit/_WidgetBase',
    'dijit/_TemplatedMixin',
    'dijit/_WidgetsInTemplateMixin',


    // templates & widget css
    'dojo/text!./Search/templates/Search.html',
    'dojo/i18n!./Search/nls/resource',
    'xstyle/css!./Search/css/Search.css',

    // not referenced
    'dijit/form/FilteringSelect',
    'dijit/layout/TabContainer',
    'dijit/layout/ContentPane',

    'dijit/form/Button',
    'dijit/form/TextBox',
    'dijit/form/Select',
    'dijit/form/SimpleTextarea',
    'dojox/grid/DataGrid'

], function (Controller,
             declare, lang, aspect, array,
             on, keys, Point, GeometryService, BufferParameters, SpatialReference,
             QueryTask, Query, FeatureTable, registry, all,
             TooltipDialog, popup, Standby,
             Geocoder, dom, domConstruct, domStyle, domClass,
             put,
             proj4, Memory, IdentifyTask, ItemFileWriteStore,
             Color, Draw, topic, GraphicsLayer, Graphic, UniqueValueRenderer, SimpleRenderer, SimpleMarkerSymbol, SimpleLineSymbol, SimpleFillSymbol,
             _WidgetBase, _TemplatedMixin, _WidgetsInTemplateMixin,
             template, i18n, css) {

    return declare([_WidgetBase, _TemplatedMixin, _WidgetsInTemplateMixin], {
        widgetsInTemplate: true,
        templateString: template,
        baseClass: 'gis_GotoDijit',
        i18n: i18n,
        standby: null,
        ids: [],
        objectiidfield: null,
        drawToolbar: null,
        mapClickMode: null,
        queryID: 0,
        geocoderOptions: {
            autoComplete: true
        },
        geocoderResults: null,
        // default symbology for found features
        defaultSymbols: {
            point: {
                type: 'esriSMS',
                style: 'esriSMSCircle',
                size: 10,
                color: [0, 255, 255, 32],
                angle: 0,
                xoffset: 0,
                yoffset: 0,
                outline: {
                    type: 'esriSLS',
                    style: 'esriSLSSolid',
                    color: [0, 255, 255, 255],
                    width: 2
                }
            },
            polyline: {
                type: 'esriSLS',
                style: 'esriSLSSolid',
                color: [0, 255, 255, 255],
                width: 3
            },
            polygon: {
                type: 'esriSFS',
                style: 'esriSFSSolid',
                color: [0, 255, 255, 32],
                outline: {
                    type: 'esriSLS',
                    style: 'esriSLSSolid',
                    color: [0, 255, 255, 255],
                    width: 3
                }
            }
        },
        layerSeparator: '||',
        geometries2search: [],
        resultfields: null,

        postCreate: function () {
            this.inherited(arguments);

            this.SearchByAttribute.title = this.i18n.TabSearchByAttribute;
            this.SearchSpatial.title = this.i18n.TabSearchSpatial;
            this.SearchByAddress.title = this.i18n.TabSearchByAddress;
            this.SearchBySelection.title = this.i18n.TabSearchBySelection;

            this.drawToolbar = new Draw(this.map);
            this.drawToolbar.on('draw-end', lang.hitch(this, 'onDrawToolbarDrawEnd'));
            this.createGraphicLayers();
            this.own(topic.subscribe('mapClickMode/currentSet', lang.hitch(this, 'setMapClickMode')));

            var options = lang.mixin({}, this.geocoderOptions, {
                map: this.map
            });
            this.geocoder = new Geocoder(options, this.geocoderNode);

            on(this.geocoder, 'select', lang.hitch(this, function (e) {
                if (e.result) {
                    var point = e.result;
                    this.geocoderResults = point.feature.geometry;
                }
            }));
            this.geocoder.startup();

            this.layers = [];
            array.forEach(this.layerInfos, function (layerInfo) {
                var lyrId = layerInfo.layer.id;
                var layer = this.map.getLayer(lyrId);
                if (layer) {
                    var url = layer.url;

                    // handle feature layers
                    if (layer.declaredClass === 'esri.layers.FeatureLayer') {

                        // If it is a feature Layer, we get the base url
                        // for the map service by removing the layerId.
                        var lastSL = url.lastIndexOf('/' + layer.layerId);
                        if (lastSL > 0) {
                            url = url.substring(0, lastSL);
                        }
                    }

                    this.layers.push({
                        ref: layer,
                        layerInfo: layerInfo,
                        identifyTask: new IdentifyTask(url),
                        url: url
                    });

                    // rebuild the layer selection list when any layer is hidden
                    // but only if we have a UI
                    if (this.parentWidget) {
                        layer.on('visibility-change', lang.hitch(this, function (evt) {
                            if (evt.visible === false) {
                                this.createIdentifyLayerList();
                            }
                        }));
                    }
                }
            }, this);

            // rebuild the layer selection list when the map is updated
            // but only if we have a UI
            if (this.parentWidget) {
                this.createIdentifyLayerList();
                this.map.on('update-end', lang.hitch(this, function () {
                    this.createIdentifyLayerList();
                }));
            }

            //this.createFeatureTable();

            this.standby = new Standby({target: "mapCenter"});
            document.body.appendChild(this.standby.domNode);
            this.standby.startup();

        },
        
        startup: function () {
            this.inherited(arguments);
            var parent = this.getParent();
            if (parent) {
                this.own(on(parent, 'show', lang.hitch(this, function () {
                    this.goTo_DijitcontainerNode.resize();
                })));
            }
            aspect.after(this, 'resize', lang.hitch(this, function () {
                this.goTo_DijitcontainerNode.resize();
            }));
        },


        // Start Tab1

        updateLayerFieldsDataGrid: function () {
            var t = this;
            var queryTask = new QueryTask(t.selectionIdentifyLayerDijit.item.url + '/' + t.selectionIdentifyLayerDijit.item.subID);
            var query = new Query();
            query.returnGeometry = false;
            query.outFields = ['*'];
            query.where = '1=1';
            query.outSpatialReference = t.map.spatialReference;
            queryTask.execute(query, lang.hitch(this, 'getLayerFields'));
        },

        getLayerFields: function (results) {
            var t = this;
            t.resultfields = results;
            var itemList = [];
            var store = new ItemFileWriteStore({
                data: {
                    identifier: 'name',
                    items: itemList
                }
            });
            array.forEach(results.fields, function (field) {
                store.newItem({name: field.name, alias: field.alias, type: field.type});
            });
            t.layerFieldsDataGrid.setStore(store);
        },

        onFieldLayerClick: function (e) {
            var t = this;
            var item = e.grid.getItem(e.rowIndex);
            var fieldname = item.name[0];
            var fieldtype = item.type[0];

            var text = this.sqltxt.getValue();
            text = text + ' ' + fieldname;
            this.sqltxt.setValue(text);

            var itemList = [];
            var store = new ItemFileWriteStore({
                data: {
                    identifier: 'fieldvalue',
                    items: itemList
                }
            });

            array.forEach(t.resultfields.features, function (feature) {
                if (feature.attributes[fieldname] != null) {

                    var item2search = feature.attributes[fieldname];
                    if(fieldtype == 'esriFieldTypeDate'){
                        var epochDate = feature.attributes[fieldname];
                        var humanDate = new Date(epochDate);
                        finalDate = dojo.date.locale.format(humanDate,{
                            datePattern : "yyyy-MM-dd",
                            selector : 'date'
                        });
                        item2search = finalDate;
                    }

                    store.fetch({
                        query: {fieldvalue: item2search},
                        onComplete: function (items, request) {
                            if (items.length == 0){
                                if(fieldtype == 'esriFieldTypeDate'){

                                    store.newItem({fieldvalue: item2search});
                                }
                                else
                                    store.newItem({fieldvalue: item2search});
                            }

                        }
                    });
                }
            });
            t.layerFieldValuesDataGrid.setStore(store);
        },

        onFieldValueClick: function(e){
            var t = this;
            var type = t.layerFieldsDataGrid.selection.getSelected()[0].type[0];
            var value = t.layerFieldValuesDataGrid.selection.getSelected()[0].fieldvalue[0];

            if(type == 'esriFieldTypeString' || type == 'esriFieldTypeDate')
                value = '\'' + value + '\'';


            var text = this.sqltxt.getValue();
            text = text + ' ' + value;
            this.sqltxt.setValue(text);
        },

        add2sqltxt1: function () {
            var text = this.sqltxt.getValue();
            text = text + ' = ';
            this.sqltxt.setValue(text);
        },

        add2sqltxt2: function () {
            var text = this.sqltxt.getValue();
            text = text + ' != ';
            this.sqltxt.setValue(text);
        },

        add2sqltxt3: function () {
            var text = this.sqltxt.getValue();
            text = text + ' > ';
            this.sqltxt.setValue(text);
        },

        add2sqltxt4: function () {
            var text = this.sqltxt.getValue();
            text = text + ' < ';
            this.sqltxt.setValue(text);
        },

        add2sqltxt5: function () {
            var text = this.sqltxt.getValue();
            text = text + ' >= ';
            this.sqltxt.setValue(text);
        },

        add2sqltxt6: function () {
            var text = this.sqltxt.getValue();
            text = text + ' <= ';
            this.sqltxt.setValue(text);
        },

        add2sqltxt7: function () {
            var text = this.sqltxt.getValue();
            text = text + ' Like ';
            this.sqltxt.setValue(text);
        },

        add2sqltxt8: function () {
            var text = this.sqltxt.getValue();
            text = text + '\'';
            this.sqltxt.setValue(text);
        },

        add2sqltxt9: function () {
            var text = this.sqltxt.getValue();
            text = text + ' And ';
            this.sqltxt.setValue(text);
        },

        add2sqltxt10: function () {
            var text = this.sqltxt.getValue();
            text = text + ' Or ';
            this.sqltxt.setValue(text);
        },

        add2sqltxtClear: function () {
            this.sqltxt.setValue('');
        },

        searchByAttributes: function () {

            this.standby.show();

            var selectionLayerUrl = this.selectionIdentifyLayerDijit.item.url + '/' + this.selectionIdentifyLayerDijit.item.subID;
            var queryTask = new QueryTask(selectionLayerUrl);
            var query = new Query();
            query.returnGeometry = true;
            query.outSpatialReference = this.map.spatialReference;
            query.outFields = ['*'];
            query.where = this.sqltxt.getValue();
            queryTask.execute(query, lang.hitch(this, 'showResultsFinal'));
        },


        // End Tab1

        // Start Tab2
        createGraphicLayers: function () {
            this.pointSymbol = new SimpleMarkerSymbol(SimpleMarkerSymbol.STYLE_CIRCLE, 5, new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new Color([255, 0, 0]), 1), new Color([255, 0, 0, 1.0]));
            this.polylineSymbol = new SimpleLineSymbol(SimpleLineSymbol.STYLE_DASH, new Color([255, 0, 0]), 1);
            this.polygonSymbol = new SimpleFillSymbol(SimpleFillSymbol.STYLE_SOLID, new SimpleLineSymbol(SimpleLineSymbol.STYLE_DASHDOT, new Color([255, 0, 0]), 2), new Color([255, 0, 0, 0.0]));

            this.selectionLayer = new esri.layers.GraphicsLayer();
            this.map.addLayer(this.selectionLayer);

            this.selectGraphics = new GraphicsLayer({
                id: 'searchGraphic_layer',
                title: 'searchGraphic_layer'
            });
            this.map.addLayer(this.selectGraphics);

            // pointer for selection
            var pointSymbol = null,
                polylineSymbol = null,
                polygonSymbol = null;
            var pointRenderer = null,
                polylineRenderer = null,
                polygonRenderer = null;

            var symbols = lang.mixin({}, this.symbols);
            // handle each property to preserve as much of the object heirarchy as possible
            symbols = {
                point: lang.mixin(this.defaultSymbols.point, symbols.point),
                polyline: lang.mixin(this.defaultSymbols.polyline, symbols.polyline),
                polygon: lang.mixin(this.defaultSymbols.polygon, symbols.polygon)
            };

            // points
            this.pointGraphics = new GraphicsLayer({
                id: 'findGraphics_point',
                title: 'Find'
            });

            if (symbols.point) {
                pointSymbol = new SimpleMarkerSymbol(symbols.point);
                pointRenderer = new SimpleRenderer(pointSymbol);
                pointRenderer.label = 'Find Results (Points)';
                pointRenderer.description = 'Find results (Points)';
                this.pointGraphics.setRenderer(pointRenderer);
            }

            // poly line
            this.polylineGraphics = new GraphicsLayer({
                id: 'findGraphics_line',
                title: 'Find Graphics'
            });

            if (symbols.polyline) {
                polylineSymbol = new SimpleLineSymbol(symbols.polyline);
                polylineRenderer = new SimpleRenderer(polylineSymbol);
                polylineRenderer.label = 'Find Results (Lines)';
                polylineRenderer.description = 'Find Results (Lines)';
                this.polylineGraphics.setRenderer(polylineRenderer);
            }

            // polygons
            this.polygonGraphics = new GraphicsLayer({
                id: 'findGraphics_polygon',
                title: 'Find Graphics'
            });

            if (symbols.polygon) {
                polygonSymbol = new SimpleFillSymbol(symbols.polygon);
                polygonRenderer = new SimpleRenderer(polygonSymbol);
                polygonRenderer.label = 'Find Results (Polygons)';
                polygonRenderer.description = 'Find Results (Polygons)';
                this.polygonGraphics.setRenderer(polygonRenderer);
            }

            this.map.addLayer(this.polygonGraphics);
            this.map.addLayer(this.polylineGraphics);
            this.map.addLayer(this.pointGraphics);
        },

        drawPoint: function () {
            this.clearResults();
            //this.selectGraphics.clear();
            //this.selectionLayer.clear();
            this.pointRenderer = new SimpleRenderer(this.pointSymbol);
            this.pointRenderer.label = 'User drawn points';
            this.pointRenderer.description = 'User drawn points';
            this.selectGraphics.setRenderer(this.pointRenderer);

            this.simeio.setDisabled(false);
            this.grammi.setDisabled(true);
            this.kiklos.setDisabled(true);
            this.poligono.setDisabled(true);

            this.disconnectMapClick();
            this.drawToolbar.activate(Draw.MULTI_POINT);
        },
        drawLine: function () {
            //this.clearResults();
            //this.selectGraphics.clear();
            //this.selectionLayer.clear();
            this.polylineRenderer = new SimpleRenderer(this.polylineSymbol);
            this.polylineRenderer.label = 'User drawn lines';
            this.polylineRenderer.description = 'User drawn lines';
            this.selectGraphics.setRenderer(this.polylineRenderer);

            this.simeio.setDisabled(true);
            this.grammi.setDisabled(false);
            this.kiklos.setDisabled(true);
            this.poligono.setDisabled(true);

            this.disconnectMapClick();
            this.drawToolbar.activate(Draw.POLYLINE);
        },
        drawPolygon: function () {
            //this.clearResults();
            //this.selectGraphics.clear();
            //this.selectionLayer.clear();
            this.polygonRenderer = new UniqueValueRenderer(new SimpleFillSymbol(), 'ren', null, null, ', ');
            this.polygonRenderer.addValue({
                value: 1,
                symbol: new SimpleFillSymbol({
                    callolor: [255, 0, 0, 255],
                    outline: {
                        color: [255, 0, 0, 255],
                        width: 1,
                        type: 'esriSLS',
                        style: 'esriSLSSolid'
                    },
                    type: 'esriSFS',
                    style: 'esriSFSForwardDiagonal'
                }),
                label: 'User drawn polygons',
                description: 'User drawn polygons'
            });
            this.selectGraphics.setRenderer(this.polygonRenderer);

            this.simeio.setDisabled(true);
            this.grammi.setDisabled(true);
            this.kiklos.setDisabled(true);
            this.poligono.setDisabled(false);

            this.disconnectMapClick();
            this.drawToolbar.activate(Draw.POLYGON);
        },
        drawCircle: function () {
            this.polygonRenderer = new UniqueValueRenderer(new SimpleFillSymbol(), 'ren', null, null, ', ');
            this.polygonRenderer.addValue({
                value: 1,
                symbol: new SimpleFillSymbol({
                    color: [255, 0, 0, 255],
                    outline: {
                        color: [255, 0, 0, 255],
                        width: 1,
                        type: 'esriSLS',
                        style: 'esriSLSSolid'
                    },
                    type: 'esriSFS',
                    style: 'esriSFSForwardDiagonal'
                }),
                label: 'User drawn polygons',
                description: 'User drawn polygons'
            });
            this.selectGraphics.setRenderer(this.polygonRenderer);

            this.simeio.setDisabled(true);
            this.grammi.setDisabled(true);
            this.kiklos.setDisabled(false);
            this.poligono.setDisabled(true);

            this.disconnectMapClick();
            this.drawToolbar.activate(Draw.CIRCLE);
        },
        endDrawing: function () {
            this.pointGraphics.clear();
            this.polylineGraphics.clear();
            this.polygonGraphics.clear();
            //this.selectGraphics.clear();
            this.selectionLayer.clear();
        },
        disconnectMapClick: function () {
            topic.publish('mapClickMode/setCurrent', 'draw');
        },
        connectMapClick: function () {
            topic.publish('mapClickMode/setDefault');
        },
        onDrawToolbarDrawEnd: function (evt) {
            this.drawToolbar.deactivate();
            var graphic;
            switch (evt.geometry.type) {
                case 'multipoint':
                    graphic = new Graphic(evt.geometry);
                    this.selectGraphics.add(graphic);
                    break;
                case 'polyline':
                    graphic = new Graphic(evt.geometry);
                    this.selectGraphics.add(graphic);
                    break;
                case 'polygon':
                    graphic = new Graphic(evt.geometry, null, {
                        ren: 1
                    });
                    this.selectGraphics.add(graphic);
                    break;
                default:
            }

        },
        setMapClickMode: function (mode) {
            this.mapClickMode = mode;
        },
        clearResults: function () {

            this.simeio.setDisabled(false);
            this.grammi.setDisabled(false);
            this.kiklos.setDisabled(false);
            this.poligono.setDisabled(false);

            this.selectGraphics.clear();
            this.map.graphics.clear();

        },
        searchByGeometry: function () {
            if (this.selectGraphics.graphics.length >= 1) {
                this.standby.show();

                esriConfig.defaults.geometryService = new GeometryService(this.GeometryService_url);
                esriConfig.defaults.io.proxyUrl = this.proxy_url;
                esriConfig.defaults.io.alwaysUseProxy = false;

                //make array of geometries
                var geometries = [];
                array.forEach(this.selectGraphics.graphics, function (graphic) {
                    geometries.push(graphic.geometry);
                });

                //console.log(geometries);

                //setup the buffer parameters
                var params = new BufferParameters();
                if (this.bufferOption.checked)
                    params.distances = [dom.byId("bufferDistance").value];
                else
                    params.distances = ['0.1'];
                params.outSpatialReference = this.map.spatialReference;
                params.unit = GeometryService['UNIT_METER'];
                params.geometries = geometries;
                esriConfig.defaults.geometryService.buffer(params, lang.hitch(this, 'showBuffer'));

            }
            this.connectMapClick();
        },

        showBuffer: function (bufferedGeometries) {
            var t = this;
            t.geometries2search = [];
            var symbol = new SimpleFillSymbol(
                SimpleFillSymbol.STYLE_SOLID,
                new SimpleLineSymbol(
                    SimpleLineSymbol.STYLE_SOLID,
                    new Color([255, 0, 0, 0.65]), 2
                ),
                new Color([255, 0, 0, 0.35])
            );

            array.forEach(bufferedGeometries, function (geometry) {
                var graphic = new Graphic(geometry, symbol);
                t.map.graphics.add(graphic);
                t.geometries2search.push(geometry);
            });

            //console.log(t.geometries2search);

            t.searchRunFromBuffer();

        },

        searchRunFromBuffer: function () {

            //console.log(this.geometries2search);
            var t = this;

            t.simeio.setDisabled(true);
            t.grammi.setDisabled(true);
            t.kiklos.setDisabled(true);
            t.poligono.setDisabled(true);

            var array_of_promises = [];

            array.forEach(this.geometries2search, function (geometry) {
                var queryTask = new QueryTask(t.selectionIdentifyLayerDijit.item.url + '/' + t.selectionIdentifyLayerDijit.item.subID);
                var query = new Query();
                query.returnGeometry = true;
                query.outFields = ['*'];
                query.where = '1=1';
                query.geometry = geometry;
                query.outSpatialReference = t.map.spatialReference;
                var promise = queryTask.execute(query);
                array_of_promises.push(promise);
            });


            var promises = all(array_of_promises);
            promises.then(lang.hitch(this, 'handleQueryResults'));

        },

        handleQueryResults: function (results) {
            var mergeFeatures = results[0];

            //console.log(results);

            array.forEach(results, function (result) {
                array.forEach(result.features, function (feature) {
                    array.forEach(mergeFeatures.features, function (existsFeature) {
                        //if (feature.OBJECTID != existsFeature.OBJECTID)
                            results[0].features.push(feature);
                    });
                });
            });

            //console.log(mergeFeatures);

            this.showResultsFinal(mergeFeatures);
        },

        showResultsFinal: function (mergeFeatures) {

            //console.log(mergeFeatures);

            var t = this;
            t.ids = [];
            t.objectiidfield = null;

            array.forEach(mergeFeatures.fields, function (field) {
                if (field.type == 'esriFieldTypeOID')
                    t.objectiidfield = field.name;
            });

            array.forEach(mergeFeatures.features, function (featuremerge) {
                for (var name in featuremerge.attributes) {
                    if (name == t.objectiidfield)
                        t.ids.push(featuremerge.attributes[name]);
                }
            });


            if (mergeFeatures.features.length > 0)
                this.createFeatureTable();
            else
                alert("Δεν βρέθηκαν αποτελέσματα...")

            this.standby.hide();
        },

        // End Tab2

        // Start Tab3

        searchByAddress: function () {

            //console.log(this.geocoderResults);
            if (this.geocoderResults) {
                this.standby.show();

                esriConfig.defaults.geometryService = new GeometryService(this.GeometryService_url);
                esriConfig.defaults.io.proxyUrl = this.proxy_url;
                esriConfig.defaults.io.alwaysUseProxy = false;

                //make array of geometries
                var geometries = [];
                geometries.push(this.geocoderResults);


                //setup the buffer parameters
                var params = new BufferParameters();
                if (!dom.byId("bufferDistance2").value)
                    params.distances = ['0.1'];
                else
                    params.distances = [dom.byId("bufferDistance2").value];
                params.outSpatialReference = this.map.spatialReference;
                params.unit = GeometryService['UNIT_METER'];
                params.geometries = geometries;
                esriConfig.defaults.geometryService.buffer(params, lang.hitch(this, 'showBuffer'));
            }
            this.connectMapClick();

        },

        // End Tab3

        // Start Tab4

        createIdentifyLayerList: function () {
            var id = null;
            var identifyItems = [];
            var selectedId = this.selectionIdentifyLayerDijit.get('value');
            var sep = this.layerSeparator;

            array.forEach(this.layers, lang.hitch(this, function (layer) {

                var ref = layer.ref,
                    selectedIds = layer.layerInfo.layerIds;
                // only include layers that are currently visible
                if (ref.visible) {
                    var name = this.getLayerName(layer);
                    if ((ref.declaredClass === 'esri.layers.FeatureLayer') && !isNaN(ref.layerId)) { // feature layer
                        identifyItems.push({
                            name: name,
                            id: ref.id + sep + ref.layerId,
                            url: layer.url,
                            subID: ref.layerId
                        });
                        // previously selected layer is still visible so keep it selected
                        if (ref.id + sep + ref.layerId === selectedId) {
                            id = selectedId;
                        }
                    } else { // dynamic layer
                        array.forEach(ref.layerInfos, lang.hitch(this, function (layerInfo) {
                            if (!this.includeSubLayer(layerInfo, ref, selectedIds)) {
                                return;
                            }
                            identifyItems.push({
                                name: name + ' \\ ' + layerInfo.name,
                                id: ref.id + sep + layerInfo.id,
                                url: layer.url,
                                subID: layerInfo.id
                            });
                            // previously selected sublayer is still visible so keep it selected
                            if (ref.id + sep + layerInfo.id === selectedId) {
                                id = selectedId;
                            }
                        }));
                    }
                }
            }));

            identifyItems.sort(function (a, b) {
                return (a.name > b.name) ? 1 : ((b.name > a.name) ? -1 : 0);
            });


            this.selectionIdentifyLayerDijit.set('disabled', (identifyItems.length < 1));
            //this.selectionIdentifyLayerDijit2.set('disabled', (identifyItems.length < 1));

            if (identifyItems.length < 1) {
                //this.selectPoligono.setDisabled(true);
                //this.selection_find.setDisabled(true);
                //this.selection_clear.setDisabled(false);
                //this.buffer_find.setDisabled(true);
                //this.bufferForSelectionOption.setDisabled(true);
            }
            else {
                //this.selectPoligono.setDisabled(false);
                //this.selection_find.setDisabled(false);
                //this.selection_clear.setDisabled(false);
                //this.buffer_find.setDisabled(false);
                //this.bufferForSelectionOption.setDisabled(false);
            }


            if (identifyItems.length > 0) {
                /*
                 identifyItems.unshift({
                 name: this.i18n.labels.allVisibleLayers,
                 id: '***'
                 });
                 */
                if (!id) {
                    id = identifyItems[0].id;
                }
            }
            var identify = new Memory({
                data: identifyItems
            });
            this.selectionIdentifyLayerDijit.set('store', identify);
            this.selectionIdentifyLayerDijit.set('value', id);

            this.selectionIdentifyLayerDijit2.set('store', identify);
            this.selectionIdentifyLayerDijit2.set('value', id);
        },
        includeSubLayer: function (layerInfo, ref, selectedIds) {
            // exclude group layers
            if (layerInfo.subLayerIds !== null) {
                return false;
            }
            // only include sublayers that are currently visible
            if (array.indexOf(ref.visibleLayers, layerInfo.id) < 0) {
                return false;
            }
            // only include sublayers that are within the current map scale
            if (!this.layerVisibleAtCurrentScale(layerInfo)) {
                return false;
            }

            // restrict which layers are included
            if (selectedIds) {
                if (array.indexOf(selectedIds, layerInfo.id) < 0) {
                    return false;
                }
            }

            // don't allow the layer if we don't have an  infoTemplate
            // already and creating a default one is not desired
            /*
             if (!this.createDefaultInfoTemplates) {
             var infoTemplate = this.getInfoTemplate(ref, layerInfo.id);
             if (!infoTemplate) {
             return false;
             }
             }
             */

            // all tests pass so include this sublayer
            return true;
        },
        getLayerName: function (layer) {
            var name = null;
            if (layer.layerInfo) {
                name = layer.layerInfo.title;
            }
            if (!name) {
                array.forEach(this.layers, function (lyr) {
                    if (lyr.ref.id === layer.id) {
                        name = lyr.layerInfo.title;
                        return;
                    }
                });
            }
            if (!name) {
                name = layer.name;
                if (!name && layer.ref) {
                    name = layer.ref._titleForLegend; // fall back to old method using title from legend
                }
            }
            return name;
        },
        layerVisibleAtCurrentScale: function (layer) {
            var mapScale = this.map.getScale();
            return !(((layer.maxScale !== 0 && mapScale < layer.maxScale) || (layer.minScale !== 0 && mapScale > layer.minScale)));
        },

        searchBySelection: function () {

            var selectionLayerUrl = this.selectionIdentifyLayerDijit2.item.url + '/' + this.selectionIdentifyLayerDijit2.item.subID;

            //make array of geometries
            var geometries = [];
            array.forEach(this.selectGraphics.graphics, function (graphic) {
                geometries.push(graphic.geometry);
            });


            var queryTask = new QueryTask(selectionLayerUrl);
            var query = new Query();
            query.returnGeometry = true;
            query.outSpatialReference = this.map.spatialReference;
            query.outFields = ['*'];
            query.geometry = geometries[0];
            query.where = '1=1';
            queryTask.execute(query, lang.hitch(this, 'getFeatureSelection'));
        },

        getFeatureSelection: function (results) {

            this.selectGraphics.clear();

            if (results.features.length >= 1) {
                this.standby.show();

                esriConfig.defaults.geometryService = new GeometryService(this.GeometryService_url);
                esriConfig.defaults.io.proxyUrl = this.proxy_url;
                esriConfig.defaults.io.alwaysUseProxy = false;

                //make array of geometries
                var geometries = [];
                array.forEach(results.features, function (feature) {
                    geometries.push(feature.geometry);
                });

                //setup the buffer parameters
                var params = new BufferParameters();
                if (this.bufferForSelectionOption.checked)
                    params.distances = [dom.byId("bufferDistanceForSelection").value];
                else
                    params.distances = ['0.1'];
                params.outSpatialReference = this.map.spatialReference;
                params.unit = GeometryService['UNIT_METER'];
                params.geometries = geometries;
                esriConfig.defaults.geometryService.buffer(params, lang.hitch(this, 'showBuffer'));
            }
            this.connectMapClick();

        },

        // End Tab4


        createFeatureTable: function () {
            var attributeTable = dijit.byId('attributesContainer_widget');
            this.queryID = this.queryID + 1;

            var tables = [
                {
                    title: this.i18n.searchTXT + ' ' + this.queryID,
                    topicID: this.queryID,
                    queryOptions: {
                        queryParameters: {
                            url: this.selectionIdentifyLayerDijit.item.url + '/' + this.selectionIdentifyLayerDijit.item.subID,
                            maxAllowableOffset: 100,
                            where: this.objectiidfield + " IN (" + this.ids + " )"
                        },
                        idProperty: this.objectiidfield
                    }
                }
            ];

            var table = attributeTable.addTab(tables[0]);

        },

        clean: function () {
            this.simeio.setDisabled(false);
            this.grammi.setDisabled(false);
            this.kiklos.setDisabled(false);
            this.poligono.setDisabled(false);

            this.selectGraphics.clear();
            this.map.graphics.clear();

            this.endDrawing();
            this.connectMapClick();

            //var attributeTable = dijit.byId('attributesContainer_widget');
            //attributeTable.tables[0].queryOptions.queryParameters.where = "1=1";
            //var table = attributeTable.addTab(attributeTable.tables[0]);
        }


    });
});
