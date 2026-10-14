/**
 * Color parameter extraction from JSON asset files.
 * Handles multiple UAsset JSON format types.
 */
import type { ColorParam, FilterDictionary } from '@/types';

/**
 * Check if a parameter name matches the filter dictionary rules.
 */
export function paramMatchesFilter(
  paramName: string,
  filterDictionary: FilterDictionary,
  isExplicitVectorParam = false
): boolean {
  if (!filterDictionary) return true;

  const paramNameLower = (paramName || '').toLowerCase();
  const excludeKeywords = (filterDictionary.exclude_keywords || []).map(k => String(k).toLowerCase());
  const hasExcludedKeyword = excludeKeywords.some(keyword => keyword && paramNameLower.includes(keyword));
  if (hasExcludedKeyword) return false;

  // VectorParameterValues are explicitly exposed by material shader designers for tinting/coloring
  if (isExplicitVectorParam) return true;

  const includeKeywords = (filterDictionary.include_keywords || []).map(k => String(k).toLowerCase());
  if (includeKeywords.length === 0) return true;

  return includeKeywords.some(keyword => keyword && paramNameLower.includes(keyword));
}

/**
 * Get the color property names from the filter dictionary, with fallbacks.
 */
function getColorPropertyNames(filterDictionary: FilterDictionary): string[] {
  return filterDictionary?.color_property_names || [
    'ColorAndOpacity', 'SpecifiedColor', 'BaseColor', 'HighlightColor',
    'FontTopColor', 'FontButtomColor', 'VectorParameter', 'ShadowColor',
    'ContentColor', 'OutlineColor', 'Color', 'TextColor', 'BackgroundColor',
  ];
}

/**
 * Recursively search a nested object tree for color properties.
 */
function findColorsRecursive(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  currentObject: any,
  currentPath: (string | number)[],
  fileName: string,
  parentName: string,
  allParams: ColorParam[],
  relativePath: string,
  filterDictionary: FilterDictionary
): void {
  if (!currentObject || typeof currentObject !== 'object') return;

  // Check 1: StructPropertyData of type LinearColor or Color
  const isLinearColorStruct =
    (currentObject.StructType === 'LinearColor' || currentObject.StructType === 'Color') &&
    currentObject.Value &&
    Array.isArray(currentObject.Value);

  if (isLinearColorStruct) {
    const colorValue = currentObject.Value[0]?.Value || currentObject.Value[0];
    if (colorValue && typeof colorValue.R !== 'undefined') {
      const propName = currentObject.Name || 'Color';
      const paramName = `${parentName} - ${propName}`;
      if (paramMatchesFilter(paramName, filterDictionary, false)) {
        const id = `${relativePath}-${parentName}-${propName}-${allParams.length}`;
        const valPath = currentObject.Value[0]?.Value
          ? [...currentPath, 'Value', 0, 'Value']
          : [...currentPath, 'Value', 0];
        const sanitizedRgba = {
          R: parseFloat(colorValue.R) || 0,
          G: parseFloat(colorValue.G) || 0,
          B: parseFloat(colorValue.B) || 0,
          A: parseFloat(colorValue.A) || 0,
        };
        allParams.push({ id, fileName, paramName, path: valPath, rgba: sanitizedRgba, relativePath });
        return;
      }
    }
  }

  // Check 2: Direct property matching known color names
  const colorNames = getColorPropertyNames(filterDictionary);
  if (
    colorNames.includes(currentObject.Name) &&
    currentObject.Value &&
    typeof currentObject.Value.R !== 'undefined'
  ) {
    const propName = currentObject.Name;
    const paramName = `${parentName} - ${propName}`;
    if (paramMatchesFilter(paramName, filterDictionary, false)) {
      const id = `${relativePath}-${parentName}-${propName}-${allParams.length}`;
      const valPath = [...currentPath, 'Value'];
      const sanitizedRgba = {
        R: parseFloat(currentObject.Value.R) || 0,
        G: parseFloat(currentObject.Value.G) || 0,
        B: parseFloat(currentObject.Value.B) || 0,
        A: parseFloat(currentObject.Value.A) || 0,
      };
      allParams.push({ id, fileName, paramName, path: valPath, rgba: sanitizedRgba, relativePath });
      return;
    }
  }

  // Recurse into children
  if (Array.isArray(currentObject)) {
    currentObject.forEach((item, index) => {
      findColorsRecursive(item, [...currentPath, index], fileName, parentName, allParams, relativePath, filterDictionary);
    });
  } else {
    for (const key of Object.keys(currentObject)) {
      if (key === 'RawData' || key === 'BulkData' || key === 'Bytes') continue;
      findColorsRecursive(currentObject[key], [...currentPath, key], fileName, parentName, allParams, relativePath, filterDictionary);
    }
  }
}

/**
 * Parse a JSON asset file and extract all color parameters.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseJsonAndExtractColors(
  json: any,
  fileName: string,
  relativePath: string,
  allParams: ColorParam[],
  filterDictionary: FilterDictionary,
  addDebugLog: (msg: string) => void
): void {
  if (!json || !Array.isArray(json.Exports)) {
    return;
  }

  json.Exports.forEach((exportItem: any, exportIndex: number) => {
    if (typeof exportItem?.Data === 'string') {
      console.warn(`Skipping RawExport in export ${exportIndex} for ${fileName}`);
      return;
    }

    const exportData = exportItem?.Data;
    const parentName = exportItem?.ObjectName || `Export_${exportIndex}`;

    // FORMAT TYPE 1: Check for VectorParameterValues anywhere in export Data
    if (Array.isArray(exportData)) {
      const vectorParamIndex = exportData.findIndex((p: any) => p.Name === 'VectorParameterValues');
      if (vectorParamIndex !== -1) {
        const vectorParamsArray = exportData[vectorParamIndex];
        if (Array.isArray(vectorParamsArray?.Value)) {
          vectorParamsArray.Value.forEach((param: any, paramIndex: number) => {
            const paramInfo = param?.Value?.find((p: any) => p.Name === 'ParameterInfo');
            const paramName = paramInfo?.Value?.find((p: any) => p.Name === 'Name')?.Value;

            if (paramName) {
              if (!paramMatchesFilter(paramName, filterDictionary, true)) return;

              const paramValueObjIndex = param?.Value?.findIndex((p: any) => p.Name === 'ParameterValue');
              if (paramValueObjIndex !== -1) {
                const paramValueObj = param.Value[paramValueObjIndex];
                const linearColor = paramValueObj?.Value?.find((p: any) => p.Name === 'ParameterValue')?.Value;

                if (linearColor && typeof linearColor.R !== 'undefined') {
                  const id = `${relativePath}-${paramName}-${exportIndex}-${paramIndex}`;
                  const path: (string | number)[] = [
                    'Exports', exportIndex, 'Data',
                    vectorParamIndex,
                    'Value', paramIndex, 'Value',
                    paramValueObjIndex,
                    'Value', 0, 'Value',
                  ];

                  const sanitizedRgba = {
                    R: parseFloat(linearColor.R) || 0,
                    G: parseFloat(linearColor.G) || 0,
                    B: parseFloat(linearColor.B) || 0,
                    A: parseFloat(linearColor.A) || 0,
                  };

                  allParams.push({ id, fileName, paramName, path, rgba: sanitizedRgba, relativePath });
                }
              }
            }
          });
        }
      }

      // Check remaining properties in this export's Data for any other LinearColor/Color properties
      exportData.forEach((prop: any, propIndex: number) => {
        if (prop.Name !== 'VectorParameterValues') {
          findColorsRecursive(prop, ['Exports', exportIndex, 'Data', propIndex], fileName, parentName, allParams, relativePath, filterDictionary);
        }
      });
    }

    // FORMAT TYPE 2: DataTableExport (RichText styles, etc.)
    if (exportItem?.$type === 'UAssetAPI.ExportTypes.DataTableExport, UAssetAPI' && Array.isArray(exportItem?.Table?.Data)) {
      exportItem.Table.Data.forEach((row: any, rowIndex: number) => {
        const styleName = row.Name || `Row_${rowIndex}`;
        const rowPath = ['Exports', exportIndex, 'Table', 'Data', rowIndex, 'Value'];
        findColorsRecursive(row.Value, rowPath, fileName, styleName, allParams, relativePath, filterDictionary);
      });
    }
  });

  console.debug(`[parseJsonAndExtractColors] Extracted ${allParams.length} params from ${fileName}`);
}
