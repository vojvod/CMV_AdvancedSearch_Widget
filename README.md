# Advanced Search Widget
An advanced search widget for CMV (http://cmv.io/). Used together with [Attributes Tables](https://github.com/tmcgee/cmv-widgets#attributes-tables) widget to query feature layers.

With this widget you can:

1. search by attributes

2. search by location

3. search by address

4. search by other selected features

![alt tag](https://github.com/vojvod/CMV_AdvancedSearch_Widget/blob/master/img1.png)



![alt tag](https://github.com/vojvod/CMV_AdvancedSearch_Widget/blob/master/img2.png)    ![alt tag](https://github.com/vojvod/CMV_AdvancedSearch_Widget/blob/master/img3.png)    ![alt tag](https://github.com/vojvod/CMV_AdvancedSearch_Widget/blob/master/img4.png)    ![alt tag](https://github.com/vojvod/CMV_AdvancedSearch_Widget/blob/master/img5.png)

## Widget Configuration
Add the widget configuration object to the widgets object in viewer.js.
```javascript
...
panes: {
  bottom: {
    id: 'sidebarBottom',
    placeAt: 'outer',
    splitter: true,
    collapsible: true,
    region: 'bottom',
    open: true,
    style: 'height:200px;',
    content: '<div id="attributesContainer"></div>'
  }
},
...
widgets: {
    ...
    search: {
      include: true,
      id: 'search',
      type: 'titlePane',
      canFloat: false,
      path: 'gis/dijit/Search',
      title: 'Advanced Search',
      open: false,
      position: 12,
      options: 'config/search'
    },
    attributesTable: {
      include: true,
      id: 'attributesContainer',
      type: 'domNode',
      srcNodeRef: 'attributesContainer',
      path: 'gis/dijit/AttributesTable',
      options: {
        map: true,
        mapClickMode: true,
        // use a tab container for multiple tables or
        // show only a single table
        useTabs: true,
        // used to open the sidebar after a query has completed
        sidebarID: 'sidebarBottom',
        // optional tables to load when the widget is first instantiated
        tables: []
      }
    },
    exportDialog: {
      include: true,
      id: 'export',
      type: 'floating',
      path: 'gis/dijit/Export',
      title: 'Αποθήκευση',
      options: {}
    }
    ...
}
```
Copy Search, AttributesTable, Export, Search.js, AttributesTable.js and Export.js to folder gis/dijit/ at your CMV installation.

Copy js/config/search.js file to js/config folder at your CMV installation. Edit file to configure proxy_url and GeometryService_url parameters.

Configure your proxy.
