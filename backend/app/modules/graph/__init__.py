"""The knowledge graph: which pages relate to which, worked out from what they say.

* :mod:`extract` - pure functions finding links and mentions of other pages' titles;
* :mod:`builder` - the background pass keeping ``page_links`` in step with the pages;
* :mod:`neighbors` - reading the graph: the pages next to some others, for a reader.
"""
