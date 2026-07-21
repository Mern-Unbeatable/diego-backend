

class PrismaQueryBuilder {
  constructor(model, query, options = {}) {
    this.model = model;
    this.query = query || {};
    this.options = {
      searchableFields: options.searchableFields || [],
      defaultSort: options.defaultSort || { createdAt: 'desc' },
      defaultLimit: options.defaultLimit || 10,
      maxLimit: options.maxLimit || 100,
      defaultPage: options.defaultPage || 1,
      populateRelations: options.populateRelations || {},
      omitFields: options.omitFields !== undefined ? options.omitFields : {},
    };

    this._where = {};
    this._orderBy = [];
    this._select = {};
    this._include = {};
    this._omit = this.options.omitFields;
    this._skip = 0;
    this._take = this.options.defaultLimit;
    this._page = this.options.defaultPage;
  }

  search() {
    const searchTerm = this.query.search || this.query.searchTerm;

    if (searchTerm && this.options.searchableFields.length > 0) {
      const searchConditions = this.options.searchableFields.map((field) => ({
        [field]: { contains: searchTerm, mode: 'insensitive' },
      }));
      this._where.OR = searchConditions;
    }

    return this;
  }

  filter() {
    const excludeFields = [
      'search', 'searchTerm', 'sort', 'sortBy', 'sortOrder',
      'limit', 'page', 'pageSize', 'fields', 'select', 'include',
    ];

    const filterFields = { ...this.query };
    excludeFields.forEach((field) => delete filterFields[field]);

    Object.keys(filterFields).forEach((key) => {
      const value = filterFields[key];

      if (value !== undefined && value !== null && value !== '') {
        if (key.startsWith('min')) {
          const field = key.replace('min', '').toLowerCase();
          if (!this._where[field]) this._where[field] = {};
          this._where[field].gte = parseFloat(value);
        } else if (key.startsWith('max')) {
          const field = key.replace('max', '').toLowerCase();
          if (!this._where[field]) this._where[field] = {};
          this._where[field].lte = parseFloat(value);
        } else if (key === 'fromDate') {
          if (!this._where.createdAt) this._where.createdAt = {};
          this._where.createdAt.gte = new Date(value);
        } else if (key === 'toDate') {
          if (!this._where.createdAt) this._where.createdAt = {};
          this._where.createdAt.lte = new Date(value);
        } else {
          this._where[key] = value;
        }
      }
    });

    return this;
  }

  sort() {
    const sortString = this.query.sort;

    if (sortString) {
      const sortFields = sortString.split(',');
      sortFields.forEach((field) => {
        let sortOrder = 'asc';
        let fieldName = field.trim();

        if (fieldName.startsWith('-')) {
          sortOrder = 'desc';
          fieldName = fieldName.substring(1);
        } else if (fieldName.startsWith('+')) {
          sortOrder = 'asc';
          fieldName = fieldName.substring(1);
        }

        this._orderBy.push({ [fieldName]: sortOrder });
      });
    } else if (this.query.sortBy) {
      const sortBy = this.query.sortBy;
      const sortOrder = (this.query.sortOrder || 'desc').toLowerCase();
      this._orderBy.push({ [sortBy]: sortOrder });
    } else {
      Object.keys(this.options.defaultSort).forEach((key) => {
        this._orderBy.push({ [key]: this.options.defaultSort[key] });
      });
    }

    return this;
  }

  paginate() {
    this._page = parseInt(this.query.page) || this.options.defaultPage;
    let limit =
      parseInt(this.query.limit) ||
      parseInt(this.query.pageSize) ||
      this.options.defaultLimit;

    if (isNaN(limit) || limit < 1) limit = this.options.defaultLimit;
    if (limit > this.options.maxLimit) limit = this.options.maxLimit;

    this._take = limit;
    this._skip = (this._page - 1) * this._take;
    if (this._skip < 0) this._skip = 0;

    return this;
  }

  fields() {
    const fieldString = this.query.fields || this.query.select;

    if (fieldString) {
      const fields = fieldString.split(',');
      fields.forEach((field) => {
        if (field && !field.startsWith('-')) {
          this._select[field.trim()] = true;
        }
      });
    }

    return this;
  }

  include() {
    const includeString = this.query.include || this.query.with;

    if (includeString && typeof includeString === 'string') {
      const relations = includeString.split(',');
      relations.forEach((relation) => {
        const trimmedRelation = relation.trim();
        if (this.options.populateRelations[trimmedRelation]) {
          this._include[trimmedRelation] =
            this.options.populateRelations[trimmedRelation];
        } else if (trimmedRelation) {
          this._include[trimmedRelation] = true;
        }
      });
    }

    Object.keys(this.options.populateRelations).forEach((relation) => {
      if (!this._include[relation]) {
        this._include[relation] = this.options.populateRelations[relation];
      }
    });

    return this;
  }

  build() {
    const queryOptions = {
      where: this._where,
      orderBy: this._orderBy,
      skip: this._skip,
      take: this._take,
    };
    if (this._omit && Object.keys(this._omit).length > 0) {
      queryOptions.omit = this._omit;
    }

    if (Object.keys(this._select).length > 0) {
      queryOptions.select = this._select;
    }

    if (Object.keys(this._include).length > 0) {
      queryOptions.include = this._include;
    }

    return queryOptions;
  }

  async execute(dataKey = 'data') {
    try {
      const queryOptions = this.build();

      const [data, total] = await Promise.all([
        this.model.findMany(queryOptions),
        this.model.count({ where: this._where }),
      ]);

      const totalPage = Math.ceil(total / this._take);

      return {
        meta: {
          page: this._page,
          limit: this._take,
          total: total || 0,
          totalPage: totalPage || 0,
        },
        [dataKey]: data || [],
      };
    } catch (error) {
      console.error('PrismaQueryBuilder execute error:', error);
      throw error;
    }
  }

  reset() {
    this._where = {};
    this._orderBy = [];
    this._select = {};
    this._include = {};
    this._skip = 0;
    this._take = this.options.defaultLimit;
    this._page = this.options.defaultPage;
    return this;
  }
}

export default PrismaQueryBuilder;