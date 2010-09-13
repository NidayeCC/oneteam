#ifndef _otOSXBADGE_H_
#define _otOSXBADGE_H_

#ifdef OT_HAS_OSXBADGE

#include "otIOSXBadge.h"

#define OT_OSXBADGE_DEFINE_FACTORY NS_GENERIC_FACTORY_CONSTRUCTOR(otOSXBadge) NS_DEFINE_NAMED_CID(OT_OSXBADGE_CID);
#define OT_OSXBADGE_FACTORY otOSXBadgeConstructor

class otOSXBadge : public otIOSXBadge {
public:
  NS_DECL_ISUPPORTS
  NS_DECL_OTIOSXBADGE
};

#else

#define OT_OSXBADGE_DEFINE_FACTORY
#define OT_OSXBADGE_FACTORY

#endif

#endif