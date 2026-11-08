export type UniversalMasterTemplateKind = 'inventory' | 'customers' | 'suppliers';

const templates: Record<UniversalMasterTemplateKind, { fileName: string; headers: string[]; example: string[] }> = {
  inventory: {
    fileName: 'SICOVEN-Plantilla-Productos.csv',
    headers: ['Codigo','Nombre','Categoria','Unidad','Existencia','CostoPromedioBs','UltimoCostoBs','UltimoCostoUsd','StockMinimo','MetodoCosteo','TratamientoIVA','TipoArticulo','CuentaInventario','CuentaCostoVentas','CuentaAjuste','CuentaContrapartidaApertura','FechaApertura','TasaBCVApertura','Precio_1','Precio_2','Precio_3','Precio_4','Moneda_Precio'],
    example: ['ART-001','Producto de ejemplo','Mercancias','Unidad','10','100','100','1','2','PROMEDIO_PONDERADO','GENERAL_16','MERCANCIA','1.1.4.01','5.1.1.01','5.1.2.01','3.3.1.01','2026-01-01','100','2.50','','','', 'USD']
  },
  customers: {
    fileName: 'SICOVEN-Plantilla-Clientes.csv',
    headers: ['Nombre','TipoIdentificacion','Identificacion','Direccion','Telefono','Correo','Activo'],
    example: ['CLIENTE DE EJEMPLO','RIF','J-12345678-9','Direccion de ejemplo','04120000000','cliente@example.com','SI']
  },
  suppliers: {
    fileName: 'SICOVEN-Plantilla-Proveedores.csv',
    headers: ['Nombre','TipoIdentificacion','Identificacion','Direccion','Telefono','Correo','Activo'],
    example: ['PROVEEDOR DE EJEMPLO','RIF','J-12345678-9','Direccion de ejemplo','04120000000','proveedor@example.com','SI']
  }
};

const csvCell = (value: string) => /[",\n\r]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;

export const getUniversalMasterTemplate = (kind: UniversalMasterTemplateKind): { fileName: string; csv: string } => {
  const template = templates[kind];
  return {
    fileName: template.fileName,
    csv: [template.headers, template.example].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
  };
};
